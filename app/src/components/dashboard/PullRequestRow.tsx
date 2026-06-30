import { Eye, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BoardPullRequest } from "./types";
import { relativeTime, stateClass } from "./utils";

export function PullRequestRow({ pullRequest }: { pullRequest: BoardPullRequest }) {
  return (
    <div className="rounded-md bg-card px-2 py-1 text-xs transition-colors hover:bg-accent">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-muted-foreground tabular-nums">{pullRequest.repository.split("/")[1]}#{pullRequest.number}</span>
        <a className="truncate" href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
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
      </div>
    </div>
  );
}
