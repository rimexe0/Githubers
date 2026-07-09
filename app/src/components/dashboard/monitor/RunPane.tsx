"use client";

import { Maximize2, Minimize2, OctagonX, Square } from "lucide-react";
import { statusMeta } from "./envelope";
import { useMonitor } from "./MonitorProvider";
import type { RunView } from "./store";
import { TerminalPane } from "./TerminalPane";

// A single run tile: status chip + project label, the tail of its output, and
// one-click interrupt/kill. The border carries attention — needs-human runs get
// a strong coloured frame; any run flashes a pulse ring on new output. Expanded,
// the tail is replaced by a live xterm pane on the same channel.
export function RunPane({
  run,
  expanded,
  onToggleExpand,
}: {
  run: RunView;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const { client } = useMonitor();
  const meta = statusMeta(run.status);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-[var(--ctp-mantle)]/40"
      style={{
        borderColor: meta.needsHuman ? meta.color : "var(--border)",
        borderWidth: meta.needsHuman ? 2 : 1,
        background: meta.needsHuman ? `color-mix(in oklab, ${meta.color} 8%, var(--ctp-mantle))` : undefined,
      }}
    >
      {/* Activity pulse — remounts on each output batch so the ring re-animates. */}
      <span key={run.lastActivity} className="monitor-pulse pointer-events-none absolute inset-0 rounded-md" style={{ ["--pulse-color" as string]: meta.color }} />

      <div className="relative flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1">
        <span
          className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide"
          style={{ background: `color-mix(in oklab, ${meta.color} 20%, var(--ctp-mantle))`, color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.7rem] font-medium" title={run.label}>
          {run.label}
        </span>
        {meta.running && (
          <button
            type="button"
            onClick={() => client.interrupt(run.channel)}
            title="Interrupt (SIGINT)"
            className="shrink-0 text-muted-foreground hover:text-[var(--ctp-yellow)]"
          >
            <Square className="size-3" />
          </button>
        )}
        {meta.running && (
          <button
            type="button"
            onClick={() => client.kill(run.channel)}
            title="Kill"
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <OctagonX className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? "Collapse" : "Expand to terminal"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {expanded ? (
          <TerminalPane channel={run.channel} className="h-full w-full p-1" />
        ) : (
          <div className="h-full min-h-0 overflow-hidden p-1.5">
            {run.error ? (
              <p className="mb-1 line-clamp-2 text-[0.6rem] text-destructive">{run.error}</p>
            ) : null}
            {run.lastLines.length === 0 ? (
              <p className="text-[0.6rem] text-muted-foreground">No output yet.</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[0.6rem] leading-tight text-[var(--ctp-subtext0)]">
                {run.lastLines.join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
