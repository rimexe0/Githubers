// One WebSocket to the daemon, multiplexed over logical channels. Owns the
// connection lifecycle (reconnect + resubscribe), outbound sequencing, and the
// render-batching hot path: stdout/stderr chunks are buffered per channel and
// flushed once per animation frame so a chatty stream never triggers a setState
// per chunk. Framework-agnostic — React glue lives in store.ts / MonitorProvider.

import type { Channel, Envelope, RpcPayload } from "./envelope";

export type ConnStatus = "connecting" | "open" | "closed" | "disabled";
export type OutputSink = (text: string) => void;
export type AnyOutputSink = (channel: Channel, text: string) => void;
export type EventListener = (env: Envelope) => void;
export type ConnListener = (status: ConnStatus) => void;

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export class MonitorClient {
  private url: string;
  private socket: WebSocket | null = null;
  private status: ConnStatus = "closed";
  private backoff = MIN_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private seq = 0;

  // Channels we want live; resent as `subscribe` frames on every (re)connect.
  private subscriptions = new Set<Channel>();
  // Last inbound seq seen per channel — drop dupes / out-of-order defensively.
  private lastInboundSeq = new Map<Channel, number>();

  // Batching: per-channel pending chunks, flushed together on one rAF tick.
  private outBuffers = new Map<Channel, string[]>();
  private flushHandle: number | null = null;

  private outputSinks = new Map<Channel, Set<OutputSink>>();
  private anyOutputSinks = new Set<AnyOutputSink>();
  private eventListeners = new Set<EventListener>();
  private connListeners = new Set<ConnListener>();
  private pendingRpc = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(url: string) {
    this.url = url;
  }

  // --- lifecycle -------------------------------------------------------------

  connect() {
    if (typeof window === "undefined") return;
    if (!this.url) {
      this.setStatus("disabled");
      return;
    }
    this.closedByUser = false;
    this.open();
  }

  private open() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    this.setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = MIN_BACKOFF_MS;
      this.setStatus("open");
      // Resubscribe every tracked channel — the daemon has no memory of us
      // across a dropped socket.
      for (const channel of this.subscriptions) this.rawSend(channel, "subscribe", {});
    };
    socket.onmessage = (event) => this.onMessage(event.data);
    socket.onclose = () => {
      this.socket = null;
      if (this.closedByUser) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("connecting");
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // onclose fires next and drives reconnect; nothing to do here.
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.flushHandle !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.flushHandle);
    this.flushHandle = null;
    this.outBuffers.clear();
    this.rejectPendingRpc(new Error("WebSocket closed"));
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  getStatus(): ConnStatus {
    return this.status;
  }

  private setStatus(status: ConnStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.connListeners) listener(status);
  }

  // --- inbound ---------------------------------------------------------------

  private onMessage(data: unknown) {
    if (typeof data !== "string") return;
    let env: Envelope;
    try {
      env = JSON.parse(data) as Envelope;
    } catch {
      return;
    }
    if (!env || typeof env.channel !== "string" || typeof env.type !== "string") return;

    // Drop dupes / stale frames per channel (monotonic seq → dupes are <= last).
    if (typeof env.seq === "number") {
      const last = this.lastInboundSeq.get(env.channel);
      if (last !== undefined && env.seq <= last) return;
      this.lastInboundSeq.set(env.channel, env.seq);
    }

    if (env.type === "stdout" || env.type === "stderr") {
      // Hot path: buffer only. Dispatched to sinks (xterm) and the global tap
      // (store) once per animation frame in flush() — never per chunk.
      const text = extractText(env.payload);
      if (text) this.bufferOutput(env.channel, text);
      return;
    }

    // Low-frequency control frames (status / permission-request / event): now.
    if (env.type === "rpc-response") this.resolveRpc((env.payload ?? {}) as RpcPayload);
    for (const listener of this.eventListeners) listener(env);
  }

  private bufferOutput(channel: Channel, text: string) {
    const buffer = this.outBuffers.get(channel);
    if (buffer) buffer.push(text);
    else this.outBuffers.set(channel, [text]);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushHandle !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      // SSR / test fallback — flush on a microtask.
      this.flushHandle = 1;
      Promise.resolve().then(() => this.flush());
      return;
    }
    this.flushHandle = requestAnimationFrame(() => this.flush());
  }

  private flush() {
    this.flushHandle = null;
    for (const [channel, chunks] of this.outBuffers) {
      if (chunks.length === 0) continue;
      const text = chunks.join("");
      const sinks = this.outputSinks.get(channel);
      if (sinks) for (const sink of sinks) sink(text);
      for (const tap of this.anyOutputSinks) tap(channel, text);
    }
    this.outBuffers.clear();
  }

  // --- outbound --------------------------------------------------------------

  private rawSend(channel: Channel, type: string, payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.seq += 1;
    try {
      this.socket.send(JSON.stringify({ channel, type, payload, seq: this.seq } satisfies Envelope));
      return true;
    } catch {
      return false;
    }
  }

  send(channel: Channel, type: string, payload: unknown = {}) {
    return this.rawSend(channel, type, payload);
  }

  subscribe(channel: Channel) {
    if (this.subscriptions.has(channel)) return;
    this.subscriptions.add(channel);
    this.rawSend(channel, "subscribe", {});
  }

  unsubscribe(channel: Channel) {
    this.subscriptions.delete(channel);
    this.lastInboundSeq.delete(channel);
  }

  stdin(channel: Channel, data: string) {
    this.rawSend(channel, "stdin", { data });
  }
  resize(channel: Channel, cols: number, rows: number) {
    this.rawSend(channel, "resize", { cols, rows });
  }
  interrupt(channel: Channel) {
    this.rawSend(channel, "interrupt", {});
  }
  kill(channel: Channel) {
    this.rawSend(channel, "kill", {});
  }
  answer(channel: Channel, payload: unknown) {
    this.rawSend(channel, "answer", payload);
  }
  rpc<T = unknown>(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<T> {
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingRpc.delete(id); reject(new Error(`RPC timed out: ${method}`)); }, timeoutMs);
      this.pendingRpc.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      if (!this.rawSend("rpc", "rpc-request", { id, method, params })) {
        clearTimeout(timer); this.pendingRpc.delete(id); reject(new Error("WebSocket is not open"));
      }
    });
  }

  private resolveRpc(payload: RpcPayload) {
    if (!payload.id) return;
    const pending = this.pendingRpc.get(payload.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pendingRpc.delete(payload.id);
    if (payload.ok) pending.resolve(payload.result);
    else pending.reject(new Error(payload.error ?? payload.code ?? "RPC failed"));
  }

  private rejectPendingRpc(error: Error) {
    for (const pending of this.pendingRpc.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pendingRpc.clear();
  }

  // --- listener registration -------------------------------------------------

  onOutput(channel: Channel, sink: OutputSink): () => void {
    const set = this.outputSinks.get(channel) ?? new Set<OutputSink>();
    set.add(sink);
    this.outputSinks.set(channel, set);
    return () => {
      const current = this.outputSinks.get(channel);
      current?.delete(sink);
      if (current && current.size === 0) this.outputSinks.delete(channel);
    };
  }

  // Batched output for every channel — the store's single tap for run cards.
  onAnyOutput(sink: AnyOutputSink): () => void {
    this.anyOutputSinks.add(sink);
    return () => this.anyOutputSinks.delete(sink);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConn(listener: ConnListener): () => void {
    this.connListeners.add(listener);
    return () => this.connListeners.delete(listener);
  }
}

// stdout/stderr payloads may be { data } | { text } | { chunk } | a bare string.
function extractText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "text", "chunk", "bytes"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return "";
}
