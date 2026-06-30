"use client";

import { ChevronLeft, ListFilter, UserRound } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { IssueRow } from "./IssueRow";
import { PullRequestRow } from "./PullRequestRow";
import type { BoardData, BoardItem, Project } from "./types";
import { api, columnAccent, projectLabel, relativeTime, stateClass } from "./utils";

type ProjectBoardState = {
  board: BoardData | null;
  error: string | null;
  loading: boolean;
  fetchId: number;
  showClosedPrs: boolean;
  selectedIssueRepo: string;
};

type ProjectBoardAction =
  | { type: "load" }
  | { type: "loaded"; board: BoardData }
  | { type: "failed"; error: string }
  | { type: "showClosedPrs"; value: boolean }
  | { type: "selectedIssueRepo"; value: string };

const ALL_USERS = "__all__";

const RELATIONSHIPS = [
  { key: "assigned", label: "Assigned to them" },
  { key: "created", label: "Created by them" },
  { key: "review", label: "Their review requested" },
] as const;

type Relationship = (typeof RELATIONSHIPS)[number]["key"];

const initialProjectBoardState: ProjectBoardState = {
  board: null,
  error: null,
  loading: true,
  fetchId: 0,
  showClosedPrs: false,
  selectedIssueRepo: "",
};

function projectBoardReducer(state: ProjectBoardState, action: ProjectBoardAction): ProjectBoardState {
  if (action.type === "load") return { ...state, loading: true, fetchId: state.fetchId + 1 };
  if (action.type === "loaded") {
    return {
      ...state,
      board: action.board,
      error: null,
      loading: false,
      selectedIssueRepo: state.selectedIssueRepo || action.board.repositories[0] || "",
    };
  }
  if (action.type === "failed") return { ...state, error: action.error, loading: false };
  if (action.type === "showClosedPrs") return { ...state, showClosedPrs: action.value };
  return { ...state, selectedIssueRepo: action.value };
}

export function ProjectBoard({ project, refreshKey, onEdit, onDelete }: { project: Project; refreshKey: number; onEdit: () => void; onDelete: () => Promise<void> }) {
  const [boardState, dispatchBoard] = useReducer(projectBoardReducer, initialProjectBoardState);
  const { board, error, loading, fetchId, showClosedPrs, selectedIssueRepo } = boardState;
  const prSwitchId = `pr-state-switch-${project.id}`;
  const issueRepo = selectedIssueRepo || board?.repositories[0] || "";

  // Per-project collapsed columns, persisted; "Done" collapses by default the first time.
  const collapsedKey = `board-collapsed-${project.id}`;
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.localStorage.getItem(collapsedKey);
      return stored ? new Set<string>(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const openNewIssue = () => {
    if (!issueRepo) return;
    window.open(`https://github.com/${issueRepo}/issues/new`, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    let cancelled = false;
    api<BoardData>(`/api/projects/${project.id}/board`)
      .then((data) => {
        if (cancelled) return;
        dispatchBoard({ type: "loaded", board: data });
        // With no saved preference, collapse "Done"-style columns by default. Idempotent
        // across reloads, and skipped once the user has toggled anything (key then exists).
        if (!window.localStorage.getItem(collapsedKey)) {
          const done = data.columns.filter((column) => /done|complete|closed/i.test(column.name)).map((column) => column.name);
          if (done.length) setCollapsedCols(new Set(done));
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        dispatchBoard({ type: "failed", error: loadError instanceof Error ? loadError.message : "Failed to load board" });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, fetchId, refreshKey, collapsedKey]);

  const toggleColumn = (name: string) => {
    setCollapsedCols((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        window.localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      } catch {
        /* ignore quota/availability errors */
      }
      return next;
    });
  };

  const load = () => {
    dispatchBoard({ type: "load" });
  };

  // Filter by a user across selectable relationships (assignee / author / reviewer).
  const [filterUser, setFilterUser] = useState<string>(ALL_USERS);
  const [rels, setRels] = useState<Record<Relationship, boolean>>({ assigned: true, created: true, review: true });
  const filtering = filterUser !== ALL_USERS;

  const allUsers = useMemo(() => {
    const set = new Set<string>();
    const add = (...logins: (string | null | undefined)[]) => logins.forEach((login) => login && set.add(login));
    board?.columns.forEach((column) => column.items.forEach((item) => add(item.author, ...item.assignees)));
    board?.openIssues.forEach((issue) => add(issue.author, ...issue.assignees));
    [...(board?.pullRequests.open ?? []), ...(board?.pullRequests.closed ?? [])].forEach((pr) => add(pr.author, ...pr.assignees, ...pr.reviewers));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [board]);

  const matchesFilter = (item: { author: string | null; assignees: string[]; reviewers?: string[] }) => {
    if (!filtering) return true;
    return (
      (rels.assigned && item.assignees.includes(filterUser)) ||
      (rels.created && item.author === filterUser) ||
      (rels.review && (item.reviewers?.includes(filterUser) ?? false))
    );
  };

  const visibleColumns = (board?.columns ?? []).map((column) => ({ name: column.name, items: column.items.filter(matchesFilter) }));
  const visibleIssues = (board?.openIssues ?? []).filter(matchesFilter);
  const visiblePrs = (showClosedPrs ? board?.pullRequests.closed : board?.pullRequests.open)?.filter(matchesFilter) ?? [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{projectLabel(project)}</h2>
        <span className="text-xs text-muted-foreground">
          {project.owner_type}/{project.owner_login} #{project.project_number}
          {board?.lastSyncedAt ? ` · synced ${relativeTime(board.lastSyncedAt)} ago` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {board && allUsers.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant={filtering ? "default" : "secondary"} size="xs" aria-label="Filter by user">
                  <ListFilter className="size-3" />
                  {filtering ? filterUser : "Filter"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">User</Label>
                    <Select value={filterUser} onValueChange={setFilterUser}>
                      <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_USERS} className="text-xs">Everyone</SelectItem>
                        {allUsers.map((login) => (
                          <SelectItem key={login} value={login} className="text-xs">{login}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs">Show items where they are</Label>
                    {RELATIONSHIPS.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox id={`rel-${key}-${project.id}`} checked={rels[key]} onCheckedChange={() => setRels((prev) => ({ ...prev, [key]: !prev[key] }))} disabled={!filtering} />
                        <Label htmlFor={`rel-${key}-${project.id}`} className="text-xs font-normal">{label}</Label>
                      </div>
                    ))}
                    <p className="text-[0.65rem] text-muted-foreground">&ldquo;Review requested&rdquo; applies to pull requests only.</p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {board && board.repositories.length > 1 && (
            <Select value={issueRepo} onValueChange={(value) => dispatchBoard({ type: "selectedIssueRepo", value })}>
              <SelectTrigger size="sm" className="w-44 text-xs" aria-label="Repository for new issue">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {board.repositories.map((repository) => (
                  <SelectItem key={repository} value={repository} className="text-xs">{repository}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="secondary" size="xs" onClick={openNewIssue} disabled={!issueRepo}>New issue</Button>
          <Button type="button" variant="secondary" size="xs" onClick={load} disabled={loading}>{loading ? "Loading..." : "Reload"}</Button>
          <Button type="button" variant="secondary" size="xs" onClick={onEdit}>Edit</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" size="xs">Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {projectLabel(project)}?</AlertDialogTitle>
                <AlertDialogDescription>This removes the project config and stored child records.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex h-full min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {board && !board.columns.length && (
            <div className="text-xs text-muted-foreground">No board items synced yet. Run a sync to pull the project.</div>
          )}
          {visibleColumns.map((column) => (
            <ColumnPanel
              key={column.name}
              column={column}
              collapsed={collapsedCols.has(column.name)}
              onToggle={() => toggleColumn(column.name)}
            />
          ))}
        </div>

        <div className="h-full w-80 shrink-0">
          <Group orientation="vertical" className="h-full min-h-0 gap-1">
            <Panel defaultSize={50} minSize={50} className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-baseline gap-2 px-2 py-1">
                  <h3 className="shrink-0 whitespace-nowrap text-xs font-semibold text-[var(--ctp-peach)]">Open issues</h3>
                  <span className="truncate text-[0.65rem] text-[var(--ctp-overlay0)]">
                    {board ? (board.repositories.length ? board.repositories.join(", ") : "no repos linked") : ""}
                  </span>
                </div>
                {board?.issuesError && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{board.issuesError}</div>}
                {board && !board.issuesError && !visibleIssues.length && (
                  <div className="px-2 text-xs text-muted-foreground">{board.repositories.length ? "No open issues." : "Link repos to this project to list their open issues."}</div>
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
                  {visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
                </div>
              </div>
            </Panel>

            <ResizeHandle orientation="vertical" />

            <Panel defaultSize={50} minSize={18} className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center gap-2 px-2 py-1">
                  <h3 className="text-xs font-semibold text-[var(--ctp-mauve)]">Pull requests</h3>
                  <span className="text-[0.65rem] text-[var(--ctp-overlay0)]">{showClosedPrs ? "closed/merged" : "open"}</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[0.65rem] text-muted-foreground" htmlFor={prSwitchId}>
                    Closed
                    <Switch id={prSwitchId} checked={showClosedPrs} onCheckedChange={(value) => dispatchBoard({ type: "showClosedPrs", value })} />
                  </label>
                </div>
                {board?.prsError && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{board.prsError}</div>}
                {board && !board.prsError && visiblePrs.length === 0 && (
                  <div className="px-2 text-xs text-muted-foreground">No {showClosedPrs ? "closed" : "open"} pull requests.</div>
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
                  {visiblePrs.map((pr) => <PullRequestRow key={pr.id} pullRequest={pr} />)}
                </div>
              </div>
            </Panel>
          </Group>
        </div>
      </div>
    </div>
  );
}

function ColumnPanel({ column, collapsed, onToggle }: { column: { name: string; items: BoardItem[] }; collapsed: boolean; onToggle: () => void }) {
  // Faint status tint on the column background only; cards keep their own background.
  const tint = `color-mix(in oklab, ${columnAccent(column.name)} 7%, var(--ctp-mantle))`;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={`Expand ${column.name}`}
        className="board-column flex h-full w-9 shrink-0 cursor-pointer flex-col items-center gap-2 py-2"
        style={{ background: tint }}
      >
        <span className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">{column.items.length}</span>
        <span className="text-xs font-semibold text-[var(--ctp-text)] [writing-mode:vertical-rl]">{column.name}</span>
      </button>
    );
  }

  return (
    <div className="board-column flex h-full w-72 shrink-0 flex-col" style={{ background: tint }}>
      <button
        type="button"
        onClick={onToggle}
        title={`Collapse ${column.name}`}
        className="flex shrink-0 cursor-pointer items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="truncate text-xs font-semibold">{column.name}</span>
        <span className="ml-auto shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">{column.items.length}</span>
        <ChevronLeft className="size-3 shrink-0 text-muted-foreground" />
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 pb-1">
        {column.items.map((item) => (
          <div key={item.id} className="board-card">
            <div className="line-clamp-2 text-xs leading-snug">
              {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
              {item.repository && <span>{item.repository.split("/")[1]}{item.number ? `#${item.number}` : ""}</span>}
              <span>{item.type === "PullRequest" ? "PR" : item.type === "DraftIssue" ? "draft" : "issue"}</span>
              {item.state && <span className={stateClass(item.state)}>{item.state.toLowerCase()}</span>}
              {item.assignees.length > 0 && (
                <span className="ml-auto flex items-center gap-1 truncate" title={`Assigned to ${item.assignees.join(", ")}`}>
                  <UserRound className="size-3 shrink-0" />
                  <span className="truncate">{item.assignees.join(", ")}</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResizeHandle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return <Separator className={`resize-handle resize-handle-${orientation}`} />;
}
