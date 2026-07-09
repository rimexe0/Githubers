// Mutable store behind useSyncExternalStore. High-frequency work (output,
// status) mutates internal maps and schedules a single rAF that rebuilds one
// immutable snapshot and notifies React once per frame — so ten streaming panes
// re-render together at most 60×/s, not once per chunk. Terminal bytes never
// reach here (they go straight to xterm via client.onOutput); this store only
// keeps the short line-tail each run card previews.

import type { AutomatorRun } from "../types";
import type { ConnStatus } from "./client";
import { attentionRank, parseRunChannel, type PermissionOption, type PermissionPayload, statusMeta, type StatusPayload } from "./envelope";

export type RunView = {
  id: string;
  channel: string;
  project: string;
  label: string;
  status: string; // freshest status word (WS coarse) or daemon enum (HTTP)
  lastLines: string[]; // capped tail for the card preview
  lastActivity: number; // ms epoch of last output — drives the activity pulse
  error?: string | null;
  prUrl?: string | null;
  autonomy?: string;
  issueNumber?: number | null;
};

export type PermissionRequest = {
  key: string;
  id: string;
  channel: string;
  question: string;
  options?: PermissionOption[];
  runId?: string;
};

export type MonitorSnapshot = {
  runs: RunView[]; // attention-sorted
  permissions: PermissionRequest[];
  connection: ConnStatus;
  version: number;
};

const TAIL_CHARS = 4000;
const PREVIEW_LINES = 8;

// run:<project>:<id> — centralized so a change to the daemon's <project> token
// is a one-line edit. project = githubRepo, else the local path, else the id.
export function runChannel(run: AutomatorRun): string {
  const project = run.githubRepo || run.repoPath || run.id;
  return `run:${project}:${run.id}`;
}

function runLabel(run: AutomatorRun): string {
  const base = run.githubRepo ?? run.repoPath ?? run.id;
  return run.issueNumber != null ? `${base} #${run.issueNumber}` : base;
}

type Internal = RunView & { _tail: string; statusAt: number };

export class MonitorStore {
  private runs = new Map<string, Internal>();
  private permissions: PermissionRequest[] = [];
  private connection: ConnStatus = "closed";

  private version = 0;
  private snapshot: MonitorSnapshot = { runs: [], permissions: [], connection: "closed", version: 0 };
  private listeners = new Set<() => void>();
  private dirtyHandle: number | null = null;

  // --- React glue ------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MonitorSnapshot => this.snapshot;

  // SSR: a stable empty snapshot.
  getServerSnapshot = (): MonitorSnapshot => EMPTY_SNAPSHOT;

  private markDirty() {
    if (this.dirtyHandle !== null) return;
    const run = () => {
      this.dirtyHandle = null;
      this.rebuild();
      for (const listener of this.listeners) listener();
    };
    if (typeof requestAnimationFrame === "undefined") {
      this.dirtyHandle = 1;
      Promise.resolve().then(run);
    } else {
      this.dirtyHandle = requestAnimationFrame(run);
    }
  }

  private rebuild() {
    const runs = [...this.runs.values()]
      .map(({ _tail, statusAt, ...view }) => {
        void _tail;
        void statusAt;
        return view;
      })
      .sort((a, b) => {
        const ra = attentionRank(statusMeta(a.status));
        const rb = attentionRank(statusMeta(b.status));
        if (ra !== rb) return ra - rb;
        return b.lastActivity - a.lastActivity; // most recent first within a tier
      });
    this.version += 1;
    this.snapshot = { runs, permissions: this.permissions, connection: this.connection, version: this.version };
  }

  // --- mutations -------------------------------------------------------------

  setConnection(status: ConnStatus) {
    if (this.connection === status) return;
    this.connection = status;
    this.markDirty();
  }

  // Merge the authoritative HTTP roster: identity fields always refresh; the
  // status word only if the roster is at least as fresh as the last WS status.
  upsertRoster(rows: AutomatorRun[]) {
    const seen = new Set<string>();
    for (const run of rows) {
      seen.add(run.id);
      const channel = runChannel(run);
      const existing = this.runs.get(run.id);
      const rosterAt = Date.parse(run.updatedAt) || 0;
      if (existing) {
        existing.channel = channel;
        existing.project = parseRunChannel(channel)?.project ?? existing.project;
        existing.label = runLabel(run);
        existing.autonomy = run.autonomy;
        existing.issueNumber = run.issueNumber;
        existing.prUrl = run.prUrl ?? existing.prUrl;
        existing.error = run.lastError ?? existing.error;
        if (rosterAt >= existing.statusAt) {
          existing.status = run.state;
          existing.statusAt = rosterAt;
        }
      } else {
        this.runs.set(run.id, {
          id: run.id,
          channel,
          project: parseRunChannel(channel)?.project ?? "",
          label: runLabel(run),
          status: run.state,
          lastLines: [],
          lastActivity: 0,
          error: run.lastError,
          prUrl: run.prUrl,
          autonomy: run.autonomy,
          issueNumber: run.issueNumber,
          _tail: "",
          statusAt: rosterAt,
        });
      }
    }
    // Drop runs the daemon no longer reports (unless mid-stream very recently).
    for (const [id, view] of this.runs) {
      if (!seen.has(id) && Date.now() - view.lastActivity > 60_000) this.runs.delete(id);
    }
    this.markDirty();
  }

  applyStatus(channel: string, payload: StatusPayload) {
    const view = this.runByChannel(channel);
    if (!view) return;
    const status = payload.status ?? payload.state;
    if (status) {
      view.status = status;
      view.statusAt = Date.now();
    }
    if (payload.error !== undefined) view.error = payload.error;
    if (payload.prUrl !== undefined) view.prUrl = payload.prUrl;
    this.markDirty();
  }

  applyOutput(channel: string, text: string) {
    const view = this.runByChannel(channel);
    if (!view) return;
    view._tail = (view._tail + stripAnsi(text)).slice(-TAIL_CHARS);
    view.lastLines = view._tail
      .split("\n")
      .map((line) => line.replace(/\r/g, "").trimEnd())
      .filter((line) => line.length > 0)
      .slice(-PREVIEW_LINES);
    view.lastActivity = Date.now();
    this.markDirty();
  }

  enqueuePermission(channel: string, payload: PermissionPayload) {
    const id = payload.id ?? channel;
    const key = `${channel}:${id}`;
    if (this.permissions.some((p) => p.key === key)) return;
    const parsed = parseRunChannel(channel);
    this.permissions = [
      ...this.permissions,
      {
        key,
        id,
        channel,
        question: payload.text ?? payload.question ?? payload.prompt ?? "The agent is requesting permission.",
        options: payload.options && payload.options.length > 0 ? payload.options : undefined,
        runId: payload.runId ?? this.runByChannel(channel)?.id ?? parsed?.id,
      },
    ];
    this.markDirty();
  }

  dequeuePermission(key: string) {
    const next = this.permissions.filter((p) => p.key !== key);
    if (next.length === this.permissions.length) return;
    this.permissions = next;
    this.markDirty();
  }

  private runByChannel(channel: string): Internal | undefined {
    for (const view of this.runs.values()) if (view.channel === channel) return view;
    // Not in the roster yet (WS raced ahead of the HTTP poll): seed a stub so
    // its output/status isn't dropped.
    const parsed = parseRunChannel(channel);
    if (!parsed) return undefined;
    const stub: Internal = {
      id: parsed.id,
      channel,
      project: parsed.project,
      label: parsed.project ? `${parsed.project} · ${parsed.id}` : parsed.id,
      status: "running",
      lastLines: [],
      lastActivity: Date.now(),
      _tail: "",
      statusAt: 0,
    };
    this.runs.set(parsed.id, stub);
    return stub;
  }
}

export const EMPTY_SNAPSHOT: MonitorSnapshot = { runs: [], permissions: [], connection: "closed", version: 0 };

// Strip CSI/OSC escape sequences for the plaintext card preview (xterm renders
// the real ANSI; the cards just want readable last lines). ESC is built from a
// char code so no control byte lives in source.
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, "g");
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
