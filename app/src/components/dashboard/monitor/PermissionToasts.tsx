"use client";

import { Check, Maximize2, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMonitor, useMonitorSnapshot } from "./MonitorProvider";
import type { PermissionRequest } from "./store";

// Global attention router: a `permission-request` on ANY channel surfaces here
// as a toast, wherever the user is on the Monitor tab. The `answer` returns on
// the same channel the request arrived on. Expand jumps to that run's pane.
export function PermissionToasts({ onExpand }: { onExpand: (runId?: string) => void }) {
  const { permissions } = useMonitorSnapshot();
  const { client, store } = useMonitor();

  if (permissions.length === 0) return null;

  const answer = (request: PermissionRequest, value: string) => {
    client.answer(request.channel, { id: request.id, value });
    store.dequeuePermission(request.key);
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
      {permissions.map((request) => (
        <div
          key={request.key}
          className="pointer-events-auto rounded-lg border-2 border-[var(--ctp-peach)] bg-card p-2.5 shadow-lg"
          style={{ background: "color-mix(in oklab, var(--ctp-peach) 8%, var(--card))" }}
        >
          <div className="mb-1.5 flex items-start gap-1.5">
            <ShieldQuestion className="mt-0.5 size-3.5 shrink-0 text-[var(--ctp-peach)]" />
            <div className="min-w-0 flex-1">
              <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ctp-peach)]">Permission needed</div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[0.72rem] text-foreground">{request.question}</p>
            </div>
            <button type="button" onClick={() => onExpand(request.runId)} title="Show this run" className="shrink-0 text-muted-foreground hover:text-foreground">
              <Maximize2 className="size-3" />
            </button>
          </div>
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
    </div>
  );
}
