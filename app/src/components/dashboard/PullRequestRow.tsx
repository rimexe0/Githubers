"use client";

import { Eye, Loader2, UserRound } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BoardPullRequest } from "./types";
import { api, relativeTime, stateClass } from "./utils";
import { RemoteActionDialog } from "./RemoteActionDialog";

export function PullRequestRow({ pullRequest }: { pullRequest: BoardPullRequest }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const review = async () => { setOpen(true); setLoading(true); setError(null); try { setReport(await api("/api/automator/pr-reviews", { method: "POST", body: JSON.stringify({ repo: pullRequest.repository, number: pullRequest.number }) })); } catch (e) { setError(e instanceof Error ? e.message : "Review failed"); } finally { setLoading(false); } };
  return (
    <>
    <div className="rounded-md bg-card px-2 py-1 text-xs transition-colors hover:bg-accent">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-muted-foreground tabular-nums">{pullRequest.repository.split("/")[1]}#{pullRequest.number}</span>
        <a className="min-w-0 flex-1 truncate" href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        <span className={stateClass(pullRequest.state)}>{pullRequest.state.toLowerCase()}</span>
        {pullRequest.onBoard && <Badge variant="secondary" className="h-4 px-1 text-[0.6rem] text-[var(--ctp-teal)]">board</Badge>}
        {pullRequest.reviewers.length > 0 && (
          <span className="flex items-center gap-1" title={`Review requested: ${pullRequest.reviewers.join(", ")}`}>
            <Eye className="size-3 shrink-0 text-[var(--ctp-yellow)]" />
            {pullRequest.reviewers.join(", ")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1" title={pullRequest.assignees.length ? `Assigned to ${pullRequest.assignees.join(", ")}` : "Unassigned"}>
          <UserRound className="size-3 shrink-0" />
          {pullRequest.assignees.length ? pullRequest.assignees.join(", ") : <span className="italic opacity-70">unassigned</span>}
        </span>
        <span>{relativeTime(pullRequest.updatedAt)}</span>
        <Button type="button" size="xs" variant="ghost" onClick={review}>Review</Button>
        {pullRequest.state === "OPEN" && <Button type="button" size="xs" variant="ghost" onClick={() => setMergeOpen(true)}>Merge…</Button>}
      </div>
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl"><DialogHeader><DialogTitle>PR review · {pullRequest.repository}#{pullRequest.number}</DialogTitle></DialogHeader>{loading ? <div className="flex items-center gap-2 text-xs"><Loader2 className="size-4 animate-spin" /> Running read-only review…</div> : error ? <div className="text-xs text-destructive">{error}</div> : report ? <ReviewReport report={report} /> : null}</DialogContent></Dialog>
    <RemoteActionDialog action={{ kind: "merge-pr", repo: pullRequest.repository, number: pullRequest.number }} open={mergeOpen} onOpenChange={setMergeOpen} onExecuted={() => setMergeOpen(false)} />
    </>
  );
}

function ReviewReport({ report }: { report: Record<string, unknown> }) {
  const verdict = report.verdict && typeof report.verdict === "object" ? report.verdict as Record<string, unknown> : {};
  return <div className="min-h-0 overflow-y-auto text-xs"><div className="mb-2 rounded bg-secondary p-2"><span className="font-semibold">Verdict: </span>{String(verdict.status ?? "unknown")}</div>{Array.isArray(verdict.blocking_issues) && verdict.blocking_issues.length > 0 && <section className="mb-2"><h3 className="font-semibold text-destructive">Blocking issues</h3><pre className="whitespace-pre-wrap">{JSON.stringify(verdict.blocking_issues, null, 2)}</pre></section>}<details><summary className="cursor-pointer font-semibold">Complete persisted report</summary><pre className="mt-1 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded bg-[var(--ctp-mantle)] p-2 text-[0.65rem]">{JSON.stringify(report, null, 2)}</pre></details></div>;
}
