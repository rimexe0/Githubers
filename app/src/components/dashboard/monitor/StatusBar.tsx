"use client";

import { Wifi, WifiOff } from "lucide-react";
import type { ConnStatus } from "./client";
import { statusMeta } from "./envelope";
import { useMonitorSnapshot } from "./MonitorProvider";

// Global at-a-glance bar: connection health + how many runs are running /
// waiting on you / failed. The counts drive where the eye should go.
export function StatusBar() {
  const { runs, connection } = useMonitorSnapshot();

  let running = 0;
  let waiting = 0;
  let failed = 0;
  for (const run of runs) {
    const meta = statusMeta(run.status);
    if (meta.label === "failed") failed += 1;
    else if (meta.needsHuman) waiting += 1;
    else if (meta.running) running += 1;
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs">
      <ConnBadge status={connection} />
      <span className="text-muted-foreground">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
      <span className="ml-auto flex items-center gap-3">
        <Count label="running" value={running} color="var(--ctp-yellow)" />
        <Count label="waiting" value={waiting} color="var(--ctp-peach)" />
        <Count label="failed" value={failed} color="var(--ctp-red)" />
      </span>
    </div>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex items-center gap-1" style={{ color: value > 0 ? color : "var(--muted-foreground)" }}>
      <span className="size-1.5 rounded-full" style={{ background: value > 0 ? color : "var(--ctp-overlay0)" }} />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function ConnBadge({ status }: { status: ConnStatus }) {
  const map: Record<ConnStatus, { label: string; color: string }> = {
    open: { label: "connected", color: "var(--ctp-green)" },
    connecting: { label: "connecting", color: "var(--ctp-yellow)" },
    closed: { label: "offline", color: "var(--ctp-red)" },
    disabled: { label: "no ws url", color: "var(--ctp-overlay1)" },
  };
  const meta = map[status];
  const Icon = status === "open" ? Wifi : WifiOff;
  return (
    <span className="flex items-center gap-1 font-medium" style={{ color: meta.color }}>
      <Icon className="size-3.5" />
      {meta.label}
    </span>
  );
}
