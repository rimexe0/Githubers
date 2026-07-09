"use client";

import { CheckCheck, ChevronDown, ChevronRight, Eye, GripVertical, ListFilter, Mail, Search, UserRound } from "lucide-react";
import { Fragment, useEffect, useMemo, useReducer, useState } from "react";
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
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Activity } from "./Activity";
import { IssueRow } from "./IssueRow";
import { PullRequestRow } from "./PullRequestRow";
import { LaneGap, type LaneLayout, loadSizeMap, moveInLayout, moveToNewLane, PaneDrop, persist, ResizeHandle } from "./tiling";
import type { AutomatorRun, BoardData, BoardItem, Project } from "./types";
import { api, columnAccent, projectLabel, relativeTime, runStateMeta, stateClass } from "./utils";

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

type Searchable = {
  title?: string | null;
  repository?: string | null;
  number?: number | null;
  author?: string | null;
  assignees?: string[];
  reviewers?: string[];
  labels?: { name: string }[];
  state?: string | null;
  type?: string | null;
};

// Universal board search: every token must match. A token that's a (#-prefixed)
// number matches the item number exactly OR as text — so "#42", "42", and
// "repo#42" all find the item, which the GitHub board search refuses to do.
function matchesSearch(query: string, item: Searchable): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.title,
    item.repository,
    item.author,
    item.state,
    item.type,
    item.number != null ? `#${item.number}` : "",
    ...(item.assignees ?? []),
    ...(item.reviewers ?? []),
    ...(item.labels?.map((label) => label.name) ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return q.split(/\s+/).every((token) => {
    const bare = token.replace(/^#/, "");
    if (/^\d+$/.test(bare) && item.number != null && String(item.number) === bare) return true;
    return haystack.includes(token);
  });
}

// --- Tiling layout -----------------------------------------------------------
// The board is lanes (horizontal) of panes (vertical stacks). Panes are status
// columns plus the fixed Issues / PRs / Activity panes, all rearrangeable.

const FIXED_PANES = ["issues", "prs", "activity"];

const layoutKey = (projectId: string) => `board-layout-${projectId}`;

function defaultLayout(columnNames: string[]): LaneLayout {
  return [...columnNames.map((name) => [`col:${name}`]), ["issues", "prs"], ["activity"]];
}

function loadStoredLayout(projectId: string): LaneLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(layoutKey(projectId));
    return raw ? (JSON.parse(raw) as LaneLayout) : null;
  } catch {
    return null;
  }
}

// Keep stored positions for panes that still exist; give newly-appeared panes
// (a new status column, say) their own lane; drop panes that vanished.
function reconcileLayout(prev: LaneLayout | null, columnNames: string[]): LaneLayout {
  const paneIds = [...columnNames.map((name) => `col:${name}`), ...FIXED_PANES];
  if (!prev) return defaultLayout(columnNames);
  const present = new Set(paneIds);
  const lanes = prev.map((lane) => lane.filter((id) => present.has(id))).filter((lane) => lane.length);
  const placed = new Set(lanes.flat());
  for (const id of paneIds) {
    if (!placed.has(id)) lanes.push([id]);
  }
  return lanes.length ? lanes : defaultLayout(columnNames);
}

export function ProjectBoard({ project, refreshKey, onEdit, onDelete }: { project: Project; refreshKey: number; onEdit: () => void; onDelete: () => Promise<void> }) {
  const isDesktop = useIsDesktop();
  const [boardState, dispatchBoard] = useReducer(projectBoardReducer, initialProjectBoardState);
  const { board, error, fetchId, showClosedPrs, selectedIssueRepo } = boardState;
  const prSwitchId = `pr-state-switch-${project.id}`;
  const issueRepo = selectedIssueRepo || board?.repositories[0] || "";

  const [search, setSearch] = useState("");
  const [filterUser, setFilterUser] = useState<string>(ALL_USERS);
  const [rels, setRels] = useState<Record<Relationship, boolean>>({ assigned: true, created: true, review: true });
  const filtering = filterUser !== ALL_USERS;

  // Per-pane collapse + drag/tiling layout, both persisted per project.
  const collapsedKey = `board-collapsed-${project.id}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = window.localStorage.getItem(collapsedKey);
      return stored ? new Set<string>(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [layout, setLayout] = useState<LaneLayout | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Agent run states keyed by "owner/repo#number", for the card badges. Loaded
  // best-effort; when the automator is disabled the proxy 503s and we no-op.
  const [runStates, setRunStates] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    api<AutomatorRun[]>("/api/automator/runs")
      .then((runs) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const run of runs) {
          if (run.githubRepo && run.issueNumber != null) map[`${run.githubRepo}#${run.issueNumber}`] = run.state;
        }
        setRunStates(map);
      })
      .catch(() => {
        /* automator disabled or unreachable — no badges */
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshKey]);

  // Resizing: explicit pane heights (vertical) and lane flex-basis (horizontal).
  // Lanes grow to fill the width, so basis is a starting size; the grow factor
  // distributes free space — a collapsed lane drops out and the rest expand.
  const heightsKey = `board-paneheights-${project.id}`;
  const basisKey = `board-lanebasis-${project.id}`;
  const [paneHeights, setPaneHeights] = useState<Record<string, number>>(() => loadSizeMap(heightsKey));
  const [laneBasis, setLaneBasis] = useState<Record<string, number>>(() => loadSizeMap(basisKey));
  const defaultBasis = (lane: string[]) => (lane.includes("activity") ? 360 : 280);
  const setPaneSize = (paneId: string, height: number) =>
    setPaneHeights((prev) => {
      const next = { ...prev, [paneId]: Math.max(80, height) };
      persist(heightsKey, next);
      return next;
    });
  const setLaneBasisFor = (sig: string, basis: number) =>
    setLaneBasis((prev) => {
      const next = { ...prev, [sig]: Math.max(180, basis) };
      persist(basisKey, next);
      return next;
    });

  // Activity pane controls live in its header (like the PRs "closed" toggle),
  // so the board owns their state and feeds them to the Activity component.
  const [actKind, setActKind] = useState("");
  const [actUnreadOnly, setActUnreadOnly] = useState(false);
  const [actDone, setActDone] = useState(false);
  const [actUnread, setActUnread] = useState(0);
  const [actReload, setActReload] = useState(0);
  const markAllRead = async () => {
    await api("/api/activity/read", { method: "POST", body: JSON.stringify({ all: true }) });
    setActReload((n) => n + 1);
  };

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
        if (!window.localStorage.getItem(collapsedKey)) {
          const done = data.columns.filter((column) => /done|complete|closed/i.test(column.name)).map((column) => `col:${column.name}`);
          if (done.length) setCollapsed(new Set(done));
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

  const columnNames = useMemo(() => (board?.columns ?? []).map((column) => column.name), [board]);

  // Derived, not effect-set: the effective layout is the user's saved/edited
  // arrangement reconciled against the panes that currently exist. Computed
  // only once the board has loaded so we never reconcile against an empty
  // column set and clobber the saved arrangement.
  const effectiveLayout = useMemo<LaneLayout | null>(
    () => (board ? reconcileLayout(layout ?? loadStoredLayout(project.id), columnNames) : null),
    [board, layout, columnNames, project.id],
  );

  useEffect(() => {
    if (!effectiveLayout) return;
    try {
      window.localStorage.setItem(layoutKey(project.id), JSON.stringify(effectiveLayout));
    } catch {
      /* ignore quota/availability errors */
    }
  }, [effectiveLayout, project.id]);

  const toggleCollapse = (paneId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(paneId)) next.delete(paneId);
      else next.add(paneId);
      try {
        window.localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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

  const visible = (item: Searchable & { author: string | null; assignees: string[]; reviewers?: string[] }) => matchesFilter(item) && matchesSearch(search, item);
  const visibleColumns = (board?.columns ?? []).map((column) => ({ name: column.name, items: column.items.filter(visible) }));
  const visibleIssues = (board?.openIssues ?? []).filter(visible);
  const visiblePrs = (showClosedPrs ? board?.pullRequests.closed : board?.pullRequests.open)?.filter(visible) ?? [];

  // --- pane drag/move ---
  const movePane = (id: string, toLane: number, toIndex: number) => {
    if (!effectiveLayout) return;
    setLayout(moveInLayout(effectiveLayout, id, toLane, toIndex));
    setDragId(null);
  };

  const movePaneToNewLane = (id: string, laneIndex: number) => {
    if (!effectiveLayout) return;
    setLayout(moveToNewLane(effectiveLayout, id, laneIndex));
    setDragId(null);
  };

  const paneMeta = (paneId: string): { title: string; accent: string } => {
    if (paneId.startsWith("col:")) {
      const name = paneId.slice(4);
      return { title: name, accent: columnAccent(name) };
    }
    if (paneId === "issues") return { title: "Open issues", accent: "var(--ctp-peach)" };
    if (paneId === "prs") return { title: "Pull requests", accent: "var(--ctp-mauve)" };
    return { title: "Activity", accent: "var(--ctp-blue)" };
  };

  const paneCount = (paneId: string): number | null => {
    if (paneId.startsWith("col:")) return visibleColumns.find((column) => column.name === paneId.slice(4))?.items.length ?? 0;
    if (paneId === "issues") return visibleIssues.length;
    if (paneId === "prs") return visiblePrs.length;
    return null;
  };

  const renderBody = (paneId: string) => {
    if (paneId.startsWith("col:")) {
      const column = visibleColumns.find((entry) => entry.name === paneId.slice(4));
      return (
        <div className="flex flex-col gap-1 p-1">
          {column?.items.map((item) => (
            <BoardCard key={item.id} item={item} runState={item.repository && item.number != null ? runStates[`${item.repository}#${item.number}`] : undefined} />
          ))}
          {!column?.items.length && <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">Empty</div>}
        </div>
      );
    }
    if (paneId === "issues") {
      return (
        <div className="flex flex-col gap-px p-1">
          {board?.issuesError && <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{board.issuesError}</div>}
          {board && !board.issuesError && !visibleIssues.length && (
            <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">{board.repositories.length ? "No open issues." : "Link repos to list their open issues."}</div>
          )}
          {visibleIssues.map((issue) => <IssueRow key={issue.id} issue={issue} runState={runStates[`${issue.repository}#${issue.number}`]} />)}
        </div>
      );
    }
    if (paneId === "prs") {
      return (
        <div className="flex flex-col gap-px p-1">
          {board?.prsError && <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{board.prsError}</div>}
          {board && !board.prsError && !visiblePrs.length && (
            <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">No {showClosedPrs ? "closed" : "open"} pull requests.</div>
          )}
          {visiblePrs.map((pr) => <PullRequestRow key={pr.id} pullRequest={pr} />)}
        </div>
      );
    }
    return (
      <div className="h-full p-1">
        <Activity
          projectId={project.id}
          active
          refreshKey={refreshKey}
          actor={filtering ? filterUser : ""}
          search={search}
          kind={actKind}
          unreadOnly={actUnreadOnly}
          includeDone={actDone}
          reloadKey={actReload}
          onStats={setActUnread}
        />
      </div>
    );
  };

  const paneHeaderExtra = (paneId: string) => {
    if (paneId === "prs") {
      return (
        <label className="flex items-center gap-1 text-[0.6rem] text-muted-foreground" htmlFor={prSwitchId}>
          closed
          <Switch id={prSwitchId} checked={showClosedPrs} onCheckedChange={(value) => dispatchBoard({ type: "showClosedPrs", value })} />
        </label>
      );
    }
    if (paneId === "activity") {
      const ctl = (active: boolean) =>
        `flex items-center gap-0.5 rounded px-1 py-0.5 ${active ? "bg-[var(--ctp-blue)] text-[var(--ctp-base)]" : "text-muted-foreground hover:bg-accent"}`;
      return (
        <div className="flex items-center gap-0.5 text-[0.6rem]">
          <select
            value={actKind}
            onChange={(event) => setActKind(event.target.value)}
            className="h-5 rounded border border-input bg-card px-0.5 text-[0.6rem] text-foreground"
            title="Filter by type"
          >
            <option value="">all</option>
            <option value="pr">PRs</option>
            <option value="issue">issues</option>
            <option value="review">reviews</option>
            <option value="comment">comments</option>
            <option value="project">board</option>
          </select>
          <button type="button" title="Unread only" onClick={() => setActUnreadOnly((value) => !value)} className={ctl(actUnreadOnly)}>
            <Mail className="size-3" />
            {actUnread > 0 && <span className="tabular-nums">{actUnread}</span>}
          </button>
          <button type="button" title="Show done" onClick={() => setActDone((value) => !value)} className={ctl(actDone)}>
            <Eye className="size-3" />
          </button>
          <button type="button" title="Mark all read" disabled={!actUnread} onClick={markAllRead} className={`${ctl(false)} disabled:opacity-40`}>
            <CheckCheck className="size-3" />
          </button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{projectLabel(project)}</h2>
        <span className="text-xs text-muted-foreground">
          {project.owner_type}/{project.owner_login} #{project.project_number}
          {board?.lastSyncedAt ? ` · synced ${relativeTime(board.lastSyncedAt)} ago` : ""}
        </span>
        <div className="relative flex w-full items-center sm:ml-auto sm:w-auto">
          <Search className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search #42, title, author, label, state…"
            className="h-7 w-full pl-7 text-xs sm:w-64"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
                    <p className="text-[0.65rem] text-muted-foreground">Filter applies to board panes and the activity pane (by actor).</p>
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

      {!isDesktop ? (
        // Mobile: no tiling/resize/drag, but keep the horizontal kanban — each pane
        // is a wide full-height column you swipe between, scrolling vertically inside.
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
          {(effectiveLayout ?? []).flat().map((paneId) => (
            <div key={paneId} className="flex h-full w-[85vw] max-w-xs shrink-0 flex-col">
              <Pane
                meta={paneMeta(paneId)}
                count={paneCount(paneId)}
                collapsed={false}
                bar={false}
                dragging={false}
                scroll={paneId !== "activity"}
                onToggle={() => {}}
                onDragStart={() => {}}
                headerExtra={paneHeaderExtra(paneId)}
              >
                {renderBody(paneId)}
              </Pane>
            </div>
          ))}
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 gap-1 overflow-x-auto pb-1" onDragEnd={() => setDragId(null)}>
        {(effectiveLayout ?? []).map((lane, laneIndex, lanesArr) => {
          const sig = lane.join(",");
          // A lane whose panes are all collapsed shrinks to a narrow strip of
          // vertical bars; expanded lanes grow to fill the freed width.
          const laneAllCollapsed = lane.every((paneId) => collapsed.has(paneId));
          const laneStyle: React.CSSProperties = laneAllCollapsed
            ? { flex: "0 0 2.25rem" }
            : { flex: `1 1 ${laneBasis[sig] ?? defaultBasis(lane)}px`, minWidth: 180 };
          const makePane = (paneId: string, isBar: boolean) => (
            <Pane
              meta={paneMeta(paneId)}
              count={paneCount(paneId)}
              collapsed={collapsed.has(paneId)}
              bar={isBar}
              dragging={dragId === paneId}
              scroll={paneId !== "activity"}
              onToggle={() => toggleCollapse(paneId)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", paneId);
                setDragId(paneId);
              }}
              headerExtra={paneHeaderExtra(paneId)}
            >
              {renderBody(paneId)}
            </Pane>
          );
          return (
            <Fragment key={sig || laneIndex}>
              {dragId && <LaneGap onDrop={() => movePaneToNewLane(dragId, laneIndex)} />}
              <div className="flex h-full min-w-0 flex-col gap-1" style={laneStyle}>
                {lane.map((paneId, paneIndex) => {
                  if (laneAllCollapsed) {
                    return (
                      <Fragment key={paneId}>
                        {dragId && dragId !== paneId && <PaneDrop onDrop={() => movePane(dragId, laneIndex, paneIndex)} />}
                        <div className="flex min-h-0 flex-1 flex-col">{makePane(paneId, true)}</div>
                      </Fragment>
                    );
                  }
                  const isCollapsed = collapsed.has(paneId);
                  const isLast = paneIndex === lane.length - 1;
                  const explicitH = paneHeights[paneId];
                  const wrapperStyle = isCollapsed ? undefined : !isLast && explicitH ? { height: explicitH, flexShrink: 0 } : { flex: "1 1 0", minHeight: 0 };
                  return (
                    <Fragment key={paneId}>
                      {dragId && dragId !== paneId && <PaneDrop onDrop={() => movePane(dragId, laneIndex, paneIndex)} />}
                      <div className={isCollapsed ? "shrink-0" : "flex min-h-0 flex-col"} style={wrapperStyle}>{makePane(paneId, false)}</div>
                      {!dragId && !isCollapsed && !isLast && (
                        <ResizeHandle axis="y" onResize={(value) => setPaneSize(paneId, value)} />
                      )}
                    </Fragment>
                  );
                })}
                {dragId && <PaneDrop trailing onDrop={() => movePane(dragId, laneIndex, lane.length)} />}
              </div>
              {!dragId && !laneAllCollapsed && laneIndex < lanesArr.length - 1 && (
                <ResizeHandle axis="x" getStart={() => laneBasis[sig] ?? defaultBasis(lane)} onResize={(value) => setLaneBasisFor(sig, value)} />
              )}
            </Fragment>
          );
        })}
        {dragId && effectiveLayout && <LaneGap onDrop={() => movePaneToNewLane(dragId, effectiveLayout.length)} />}
      </div>
      )}
    </div>
  );
}

function Pane({
  meta,
  count,
  collapsed,
  bar,
  dragging,
  scroll,
  onToggle,
  onDragStart,
  headerExtra,
  children,
}: {
  meta: { title: string; accent: string };
  count: number | null;
  collapsed: boolean;
  bar: boolean;
  dragging: boolean;
  scroll: boolean;
  onToggle: () => void;
  onDragStart: (event: React.DragEvent) => void;
  headerExtra: React.ReactNode;
  children: React.ReactNode;
}) {
  const tint = `color-mix(in oklab, ${meta.accent} 8%, var(--ctp-mantle))`;

  // Vertical bar: a collapsed pane that's alone in its lane reclaims the
  // horizontal space, with its title rotated 90° (like the old columns).
  if (bar) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-hidden rounded-md border border-border py-1.5 ${dragging ? "opacity-40" : ""}`} style={{ background: tint }}>
        <span draggable onDragStart={onDragStart} className="cursor-grab text-muted-foreground active:cursor-grabbing" title="Drag to move pane">
          <GripVertical className="size-3.5" />
        </span>
        <button type="button" onClick={onToggle} className="flex min-h-0 flex-1 flex-col items-center gap-1.5" title="Expand">
          {count != null && <span className="shrink-0 text-[0.6rem] tabular-nums text-muted-foreground">{count}</span>}
          <span className="truncate text-xs font-semibold [writing-mode:vertical-rl]" style={{ color: meta.accent }}>{meta.title}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border ${collapsed ? "" : "h-full"} ${dragging ? "opacity-40" : ""}`} style={{ background: tint }}>
      <div className="flex shrink-0 items-center gap-1.5 px-1.5 py-0.5">
        <span draggable onDragStart={onDragStart} className="cursor-grab text-muted-foreground active:cursor-grabbing" title="Drag to move pane">
          <GripVertical className="size-3.5" />
        </span>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="truncate text-xs font-semibold" style={{ color: meta.accent }}>{meta.title}</span>
          {count != null && <span className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground">{count}</span>}
        </button>
        {headerExtra}
        <button type="button" onClick={onToggle} className="shrink-0 text-muted-foreground" aria-label={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>
      {!collapsed && <div className={`min-h-0 flex-1 ${scroll ? "overflow-y-auto" : "overflow-hidden"}`}>{children}</div>}
    </div>
  );
}

function BoardCard({ item, runState }: { item: BoardItem; runState?: string }) {
  const run = runState ? runStateMeta(runState) : null;
  return (
    <div className="board-card">
      <div className="line-clamp-2 text-xs leading-snug">
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        {item.repository && <span>{item.repository.split("/")[1]}{item.number ? `#${item.number}` : ""}</span>}
        <span>{item.type === "PullRequest" ? "PR" : item.type === "DraftIssue" ? "draft" : "issue"}</span>
        {item.state && <span className={stateClass(item.state)}>{item.state.toLowerCase()}</span>}
        {run && (
          <span
            className="rounded px-1 font-semibold"
            style={{ background: `color-mix(in oklab, ${run.color} 18%, var(--ctp-mantle))`, color: run.color }}
            title="Agent run state"
          >
            ⚙ {run.label}
          </span>
        )}
        {item.assignees.length > 0 && (
          <span className="ml-auto flex items-center gap-1 truncate" title={`Assigned to ${item.assignees.join(", ")}`}>
            <UserRound className="size-3 shrink-0" />
            <span className="truncate">{item.assignees.join(", ")}</span>
          </span>
        )}
      </div>
    </div>
  );
}
