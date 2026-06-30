import { GitPullRequest, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OpenIssue } from "./types";
import { relativeTime, stateClass } from "./utils";

export function IssueRow({ issue }: { issue: OpenIssue }) {
  return (
    <div className="rounded-md bg-card px-2 py-1 text-xs transition-colors hover:bg-accent">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-muted-foreground tabular-nums">{issue.repository.split("/")[1]}#{issue.number}</span>
        <a className="truncate" href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        {issue.labels.map((label) => (
          <span key={label.name} className="flex items-center gap-1 text-[var(--ctp-subtext0)]">
            <span className="h-2 w-2 rounded-full" style={{ background: `#${label.color}` }} />
            {label.name}
          </span>
        ))}
        {issue.onBoard && <Badge variant="secondary" className="h-4 px-1 text-[0.6rem] text-[var(--ctp-teal)]">board</Badge>}
        <span className="ml-auto flex items-center gap-1" title={issue.assignees.length ? `Assigned to ${issue.assignees.join(", ")}` : "Unassigned"}>
          <UserRound className="size-3 shrink-0" />
          {issue.assignees.length ? issue.assignees.join(", ") : <span className="italic opacity-70">unassigned</span>}
        </span>
        <span>{relativeTime(issue.updatedAt)}</span>
      </div>
      {issue.linkedPullRequests.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-[var(--ctp-surface1)] pl-2">
          {issue.linkedPullRequests.map((pr) => (
            <a key={`${pr.repository}#${pr.number}`} href={pr.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[0.65rem]">
              <GitPullRequest className="size-3 shrink-0 text-[var(--ctp-mauve)]" />
              <span className="shrink-0 tabular-nums text-muted-foreground">#{pr.number}</span>
              <span className="truncate">{pr.title}</span>
              <span className={`ml-auto shrink-0 ${stateClass(pr.state)}`}>{pr.state.toLowerCase()}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
