"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AutomatorRun } from "../types";
import { api } from "../utils";
import { MonitorClient } from "./client";
import type { EventPayload, PermissionPayload, StatusPayload } from "./envelope";
import { MonitorStore, runChannel, type MonitorSnapshot } from "./store";

const ROSTER_POLL_MS = 2500;

type MonitorContextValue = { client: MonitorClient; store: MonitorStore };
const MonitorContext = createContext<MonitorContextValue | null>(null);

// Owns the single WS client + store for the Monitor surface. Seeds the run
// roster from the existing HTTP proxy (works today, degrades gracefully when the
// daemon is down) and overlays live WS state keyed by run id.
export function MonitorProvider({ wsUrl, token = "", children }: { wsUrl: string; token?: string; children: React.ReactNode }) {
  // The daemon accepts a bearer token as `?token=` on the upgrade (a browser
  // can't set the Authorization header). No-op when the URL already carries one
  // or no token is configured (tailnet-only auth).
  const url = useMemo(() => {
    if (!wsUrl || !token || wsUrl.includes("token=")) return wsUrl;
    return `${wsUrl}${wsUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  }, [wsUrl, token]);
  const client = useMemo(() => new MonitorClient(url), [url]);
  const store = useMemo(() => new MonitorStore(), []);
  const subscribed = useRef<Set<string>>(new Set());

  useEffect(() => {
    subscribed.current = new Set();

    const offConn = client.onConn((status) => store.setConnection(status));
    const offAny = client.onAnyOutput((channel, text) => store.applyOutput(channel, text));
    const offEvent = client.onEvent((env) => {
      if (env.type === "status") store.applyStatus(env.channel, (env.payload ?? {}) as StatusPayload);
      else if (env.type === "permission-request") store.enqueuePermission(env.channel, (env.payload ?? {}) as PermissionPayload);
      else if (env.type === "event") store.applyEvent(env.channel, (env.payload ?? {}) as EventPayload);
    });

    client.connect();
    store.setConnection(client.getStatus());

    let cancelled = false;
    const poll = async () => {
      try {
        const rows = await api<AutomatorRun[]>("/api/automator/runs");
        if (cancelled) return;
        store.upsertRoster(rows);
        for (const run of rows) {
          const channel = runChannel(run);
          if (!subscribed.current.has(channel)) {
            subscribed.current.add(channel);
            client.subscribe(channel);
          }
        }
      } catch {
        // Daemon unreachable — WS status already reflects "closed"; keep the
        // last known roster on screen rather than clearing it.
      }
    };
    void poll();
    const timer = setInterval(poll, ROSTER_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      offConn();
      offAny();
      offEvent();
      client.close();
    };
  }, [client, store]);

  const value = useMemo(() => ({ client, store }), [client, store]);
  return <MonitorContext.Provider value={value}>{children}</MonitorContext.Provider>;
}

export function useMonitor(): MonitorContextValue {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error("useMonitor must be used within a MonitorProvider");
  return ctx;
}

export function useMonitorSnapshot(): MonitorSnapshot {
  const { store } = useMonitor();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
