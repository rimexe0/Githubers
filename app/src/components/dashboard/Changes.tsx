"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { Change, SyncRun } from "./types";
import { relativeTime } from "./utils";

export function Changes({ changes, syncRuns }: { changes: Change[]; syncRuns: SyncRun[] }) {
  const latestSync = syncRuns[0];
  return (
    <div className="flex h-full flex-col gap-2">
      {latestSync?.error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">Last sync failed: {latestSync.error}</div>}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-px">
          {changes.map((change) => (
            <div key={change.id} className="flex items-center gap-2 rounded-md bg-card px-2 py-1 text-xs transition-colors hover:bg-accent">
              <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{relativeTime(change.occurred_at)} ago</span>
              <span className="w-36 shrink-0 truncate text-[var(--ctp-mauve)]">{change.change_type}</span>
              <span className="w-40 shrink-0 truncate text-muted-foreground">{change.repository ?? change.project_title ?? ""}</span>
              {change.url ? (
                <a className="truncate" href={change.url} target="_blank" rel="noreferrer">{change.title}</a>
              ) : (
                <span className="truncate">{change.title}</span>
              )}
              {change.actor_login && <span className="ml-auto shrink-0 text-muted-foreground">{change.actor_login}</span>}
            </div>
          ))}
          {!changes.length && <div className="px-2 py-3 text-xs text-muted-foreground">No changes captured yet. Run sync after configuring a token and project.</div>}
        </div>
      </ScrollArea>
    </div>
  );
}
