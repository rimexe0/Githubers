"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Summary } from "./types";

export function Summaries({ summaries }: { summaries: Summary[] }) {
  return (
    <div className="flex flex-col gap-2">
      {summaries.map((summary) => (
        <article key={summary.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
            <Badge variant="secondary" className="h-4 px-1.5 text-[0.6rem] text-[var(--ctp-teal)]">{summary.provider}</Badge>
            <span>{summary.change_count} changes</span>
            <span>{new Date(summary.created_at).toLocaleString()}</span>
          </div>
          <h3 className="mt-1.5 text-sm font-semibold">{summary.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ctp-subtext0)]">{summary.short_body}</p>
          <Dialog>
            <DialogTrigger asChild><Button type="button" variant="secondary" size="sm" className="mt-2">Full summary</Button></DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>{summary.title}</DialogTitle>
              </DialogHeader>
              <ScrollArea className="h-[60vh] rounded-md border border-border bg-muted/40 p-2">
                <pre className="whitespace-pre-wrap text-xs leading-5">{summary.body}</pre>
              </ScrollArea>
              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline" size="sm">Close</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </article>
      ))}
      {!summaries.length && <div className="text-xs text-muted-foreground">No summaries yet.</div>}
    </div>
  );
}
