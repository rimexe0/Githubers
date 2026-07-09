"use client";

import { Check, ChevronRight, OctagonX, Square, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { statusMeta } from "./envelope";
import { useMonitor, useMonitorSnapshot } from "./MonitorProvider";
import type { PermissionRequest } from "./store";
import { TerminalPane } from "./TerminalPane";

// Phone posture: monitor + unblock, not drive. A status-first list (already
// attention-sorted) where blocked runs show Approve/Deny inline; tapping a row
// opens the full live stream.
export function MonitorMobileList() {
  const { runs, permissions } = useMonitorSnapshot();
  const { client, store } = useMonitor();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = openId ? runs.find((run) => run.id === openId) ?? null : null;
  const permsFor = (runId: string) => permissions.filter((p) => p.runId === runId);
  const answer = (request: PermissionRequest, value: string) => {
    client.answer(request.channel, { id: request.id, value });
    store.dequeuePermission(request.key);
  };

  if (open) {
    const meta = statusMeta(open.status);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setOpenId(null)} className="text-xs text-muted-foreground hover:text-foreground">
            ← Back
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{open.label}</span>
          <span className="shrink-0 text-[0.6rem] font-semibold uppercase" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {meta.running && (
            <>
              <Button type="button" size="xs" variant="secondary" onClick={() => client.interrupt(open.channel)}>
                <Square className="size-3" />
              </Button>
              <Button type="button" size="xs" variant="destructive" onClick={() => client.kill(open.channel)}>
                <OctagonX className="size-3" />
              </Button>
            </>
          )}
        </div>
        {permsFor(open.id).map((request) => (
          <div key={request.key} className="shrink-0 rounded-md border-2 border-[var(--ctp-peach)] p-2">
            <p className="mb-1.5 text-[0.72rem]">{request.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {request.options && request.options.length > 0 ? (
                request.options.map((option) => (
                  <Button key={option.value} type="button" size="xs" variant="secondary" onClick={() => answer(request, option.value)}>
                    {option.label ?? option.value}
                  </Button>
                ))
              ) : (
                <>
                  <Button type="button" size="xs" onClick={() => answer(request, "approve")}>
                    <Check className="size-3" /> Approve
                  </Button>
                  <Button type="button" size="xs" variant="secondary" onClick={() => answer(request, "deny")}>
                    <X className="size-3" /> Deny
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <TerminalPane channel={open.channel} className="h-full w-full p-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {runs.length === 0 && <div className="px-1 py-3 text-center text-xs text-muted-foreground">No runs.</div>}
      {runs.map((run) => {
        const meta = statusMeta(run.status);
        const perms = permsFor(run.id);
        return (
          <div
            key={run.id}
            className="flex flex-col gap-1 rounded-md border p-2"
            style={{ borderColor: meta.needsHuman ? meta.color : "var(--border)", borderWidth: meta.needsHuman ? 2 : 1 }}
          >
            <button type="button" onClick={() => setOpenId(run.id)} className="flex items-center gap-2 text-left">
              <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{run.label}</span>
              <span className="shrink-0 text-[0.55rem] font-semibold uppercase" style={{ color: meta.color }}>
                {meta.label}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
            {run.lastLines.length > 0 && (
              <div className="truncate pl-4 font-mono text-[0.6rem] text-muted-foreground">{run.lastLines[run.lastLines.length - 1]}</div>
            )}
            {perms.map((request) => (
              <div key={request.key} className="flex items-center gap-1.5 pl-4">
                <span className="min-w-0 flex-1 truncate text-[0.65rem] text-[var(--ctp-peach)]">{request.question}</span>
                {request.options && request.options.length > 0 ? (
                  request.options.map((option) => (
                    <Button key={option.value} type="button" size="xs" variant="secondary" onClick={() => answer(request, option.value)}>
                      {option.label ?? option.value}
                    </Button>
                  ))
                ) : (
                  <>
                    <Button type="button" size="xs" onClick={() => answer(request, "approve")}>
                      <Check className="size-3" />
                    </Button>
                    <Button type="button" size="xs" variant="secondary" onClick={() => answer(request, "deny")}>
                      <X className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
