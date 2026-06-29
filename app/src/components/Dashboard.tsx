"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useReducer, useTransition } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

type Settings = {
  githubToken: string;
  pollIntervalMinutes: number;
  summaryProviderOrder: string;
  summaryStyle: string;
  summaryCron: string;
  commentPollLimit: number;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioTemperature: number;
  lmStudioMaxTokens: number;
  codexCommand: string;
  opencodeCommand: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  emailFrom: string;
  emailTo: string;
  telegramBotToken: string;
  telegramChatId: string;
  webhookSecret: string;
};

type Project = {
  id: string;
  owner_type: "org" | "user";
  owner_login: string;
  project_number: number;
  title: string | null;
  enabled: boolean;
  repositories: { id: string; ownerLogin: string; repoName: string; enabled: boolean }[];
};

type Change = {
  id: string;
  change_type: string;
  actor_login: string | null;
  title: string | null;
  url: string | null;
  summary: string | null;
  repository: string | null;
  occurred_at: string;
  owner_login: string | null;
  project_number: number | null;
  project_title: string | null;
};

type SyncRun = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  projects_checked: number;
  changes_found: number;
  error: string | null;
};

type Summary = {
  id: string;
  provider: string;
  title: string;
  short_body: string;
  body: string;
  change_count: number;
  created_at: string;
};

type BoardData = {
  id: string;
  title: string;
  owner: string;
  projectNumber: number;
  repositories: string[];
  columns: { name: string; items: BoardItem[] }[];
  openIssues: OpenIssue[];
  pullRequests: { open: BoardPullRequest[]; closed: BoardPullRequest[] };
  issuesError: string | null;
  prsError: string | null;
  lastSyncedAt: string | null;
};

type BoardItem = {
  id: string;
  contentId: string | null;
  title: string;
  url: string | null;
  type: string;
  state: string | null;
  repository: string | null;
  number: number | null;
  status: string;
};

type OpenIssue = {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  updatedAt: string;
  labels: { name: string; color: string }[];
  onBoard: boolean;
};

type BoardPullRequest = {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  author: string | null;
  updatedAt: string;
  onBoard: boolean;
};

const emptySettings: Settings = {
  githubToken: "",
  pollIntervalMinutes: 60,
  summaryProviderOrder: "lmstudio,codex,opencode,none",
  summaryStyle: "Concise situation summary with what changed, blockers, risks, and next actions.",
  summaryCron: "0 8 * * *",
  commentPollLimit: 50,
  lmStudioBaseUrl: "http://host.docker.internal:1234/v1",
  lmStudioModel: "local-model",
  lmStudioTemperature: 0.2,
  lmStudioMaxTokens: 2000,
  codexCommand: "codex exec",
  opencodeCommand: "opencode run",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPassword: "",
  emailFrom: "",
  emailTo: "",
  telegramBotToken: "",
  telegramChatId: "",
  webhookSecret: "",
};

type DashboardState = {
  settings: Settings;
  projects: Project[];
  changes: Change[];
  syncRuns: SyncRun[];
  summaries: Summary[];
  message: string;
};

type DashboardAction =
  | { type: "loaded"; payload: Omit<DashboardState, "message"> }
  | { type: "settings"; settings: Settings }
  | { type: "message"; message: string };

type DashboardUiState = {
  selectedTab: string | null;
  visitedTabs: Set<string>;
  boardsKey: number;
  projectDialogOpen: boolean;
  editingProject: Project | null;
};

type DashboardUiAction =
  | { type: "selectTab"; value: string; activeTab: string }
  | { type: "bumpBoardsKey" }
  | { type: "openAddProject" }
  | { type: "openEditProject"; project: Project }
  | { type: "setProjectDialogOpen"; open: boolean }
  | { type: "projectDeleted"; projectId: string };

const initialDashboardState: DashboardState = {
  settings: emptySettings,
  projects: [],
  changes: [],
  syncRuns: [],
  summaries: [],
  message: "Loading...",
};

const initialDashboardUiState: DashboardUiState = {
  selectedTab: null,
  visitedTabs: new Set(),
  boardsKey: 0,
  projectDialogOpen: false,
  editingProject: null,
};

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  if (action.type === "loaded") return { ...state, ...action.payload, message: "Ready" };
  if (action.type === "settings") return { ...state, settings: action.settings };
  return { ...state, message: action.message };
}

function dashboardUiReducer(state: DashboardUiState, action: DashboardUiAction): DashboardUiState {
  if (action.type === "selectTab") {
    const visitedTabs = new Set(state.visitedTabs);
    visitedTabs.add(action.activeTab);
    visitedTabs.add(action.value);
    return { ...state, selectedTab: action.value, visitedTabs };
  }
  if (action.type === "bumpBoardsKey") return { ...state, boardsKey: state.boardsKey + 1 };
  if (action.type === "openAddProject") return { ...state, projectDialogOpen: true, editingProject: null };
  if (action.type === "openEditProject") return { ...state, projectDialogOpen: true, editingProject: action.project };
  if (action.type === "setProjectDialogOpen") return { ...state, projectDialogOpen: action.open, editingProject: action.open ? state.editingProject : null };
  return { ...state, selectedTab: state.selectedTab === action.projectId ? null : state.selectedTab };
}

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

type ProjectFormState = {
  ownerType: "org" | "user";
  ownerLogin: string;
  projectNumber: string;
  title: string;
  repos: string;
};

type ProjectFormAction =
  | { type: "field"; key: keyof ProjectFormState; value: string }
  | { type: "ownerType"; value: "org" | "user" }
  | { type: "load"; project: Project }
  | { type: "reset" };

const emptyProjectForm: ProjectFormState = { ownerType: "org", ownerLogin: "", projectNumber: "", title: "", repos: "" };

function projectFormReducer(state: ProjectFormState, action: ProjectFormAction): ProjectFormState {
  if (action.type === "reset") return emptyProjectForm;
  if (action.type === "load") {
    return {
      ownerType: action.project.owner_type,
      ownerLogin: action.project.owner_login,
      projectNumber: String(action.project.project_number),
      title: action.project.title ?? "",
      repos: action.project.repositories.map((repo) => `${repo.ownerLogin}/${repo.repoName}`).join("\n"),
    };
  }
  if (action.type === "ownerType") return { ...state, ownerType: action.value };
  return { ...state, [action.key]: action.value };
}

function parseRepos(repos: string) {
  return repos.split("\n").flatMap((line) => {
    const repo = line.trim();
    if (!repo) return [];
    const [repoOwner, repoName] = repo.split("/");
    return repoOwner && repoName ? [{ ownerLogin: repoOwner, repoName }] : [];
  });
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function projectLabel(project: Project) {
  return project.title || `${project.owner_login} #${project.project_number}`;
}

function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const staticTabs = ["activity", "summaries", "settings"];

function stateClass(state: string | null) {
  if (state === "OPEN") return "state-open";
  if (state === "MERGED") return "state-merged";
  if (state === "CLOSED") return "state-closed";
  return "state-draft";
}

export function Dashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);
  const [ui, dispatchUi] = useReducer(dashboardUiReducer, initialDashboardUiState);
  const [isPending, startTransition] = useTransition();
  const { settings, projects, changes, syncRuns, summaries, message } = state;

  const refresh = async () => {
    const [nextSettings, nextProjects, nextChanges, nextSyncRuns, nextSummaries] = await Promise.all([
      api<Settings>("/api/settings"),
      api<Project[]>("/api/projects"),
      api<Change[]>("/api/changes"),
      api<SyncRun[]>("/api/sync"),
      api<Summary[]>("/api/summaries"),
    ]);
    dispatch({
      type: "loaded",
      payload: { settings: nextSettings, projects: nextProjects, changes: nextChanges, syncRuns: nextSyncRuns, summaries: nextSummaries },
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await refresh();
        // Cheap freshness check on load; full sync only when stale or changed upstream.
        const auto = await api<{ synced: boolean; reason: string }>("/api/sync/auto", { method: "POST" });
        if (auto.synced) {
          await refresh();
          dispatchUi({ type: "bumpBoardsKey" });
          dispatch({ type: "message", message: `Auto-synced: ${auto.reason.toLowerCase()}` });
        }
      } catch (error) {
        dispatch({ type: "message", message: error instanceof Error ? error.message : "Load failed" });
      }
    })();
  }, []);

  const setMessage = (nextMessage: string) => dispatch({ type: "message", message: nextMessage });

  const runAction = (label: string, action: () => Promise<unknown>) => {
    startTransition(async () => {
      try {
        setMessage(`${label}...`);
        await action();
        await refresh();
        setMessage(`${label} complete`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `${label} failed`);
      }
    });
  };

  const openAddProject = () => {
    dispatchUi({ type: "openAddProject" });
  };

  const openEditProject = (project: Project) => {
    dispatchUi({ type: "openEditProject", project });
  };

  const deleteProject = async (project: Project) => {
    await api(`/api/projects/${project.id}`, { method: "DELETE" });
    dispatchUi({ type: "projectDeleted", projectId: project.id });
    await refresh();
    setMessage("Project deleted");
  };

  const validTabs = [...projects.map((project) => project.id), ...staticTabs];
  const activeTab = ui.selectedTab && validTabs.includes(ui.selectedTab) ? ui.selectedTab : (projects[0]?.id ?? "activity");
  const latestSync = syncRuns[0];

  const changeTab = (value: string) => {
    dispatchUi({ type: "selectTab", value, activeTab });
  };

  return (
    <main className="h-screen w-full">
      <div className="mx-auto flex h-full w-full max-w-full flex-col">
        <header className="flex shrink-0 items-center gap-3 bg-[var(--ctp-mantle)] px-3 py-1.5">
          <span className="font-semibold text-[var(--ctp-mauve)]">githubers</span>
          <span className="text-xs text-[var(--ctp-overlay1)]">
            {latestSync ? `last sync ${relativeTime(latestSync.started_at)} ago, ${latestSync.status}` : "no syncs yet"}
          </span>
          <span className="ml-auto truncate text-xs text-[var(--ctp-subtext0)]">{message}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPending}
            onClick={() =>
              runAction("Sync", async () => {
                await api("/api/sync", { method: "POST" });
                dispatchUi({ type: "bumpBoardsKey" });
              })
            }
          >
            Sync
          </button>
          <button type="button" className="btn" disabled={isPending} onClick={() => runAction("Summary", () => api("/api/summaries", { method: "POST" }))}>
            Summarize
          </button>
        </header>

        <Tabs.Root value={activeTab} onValueChange={changeTab} className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="flex shrink-0 items-center overflow-x-auto bg-[var(--ctp-mantle)] px-1">
            {projects.map((project) => (
              <Tabs.Trigger key={project.id} value={project.id} className="tab-trigger">
                {projectLabel(project)}
              </Tabs.Trigger>
            ))}
            <button type="button" className="px-2 py-1 text-xs font-semibold text-[var(--ctp-overlay1)] hover:text-[var(--ctp-text)]" onClick={openAddProject}>
              + project
            </button>
            <div className="mx-2 h-4 w-px bg-[var(--ctp-surface0)]" />
            <Tabs.Trigger value="activity" className="tab-trigger">Activity</Tabs.Trigger>
            <Tabs.Trigger value="summaries" className="tab-trigger">Summaries</Tabs.Trigger>
            <Tabs.Trigger value="settings" className="tab-trigger">Settings</Tabs.Trigger>
          </Tabs.List>

          {projects.map((project) => (
            // forceMount keeps visited boards alive across tab switches so they fetch once.
            <Tabs.Content
              key={project.id}
              value={project.id}
              forceMount={ui.visitedTabs.has(project.id) || activeTab === project.id ? true : undefined}
              className="tab-content panel min-h-0 flex-1 overflow-hidden p-3"
            >
              <ProjectBoard project={project} refreshKey={ui.boardsKey} onEdit={() => openEditProject(project)} onDelete={() => deleteProject(project)} />
            </Tabs.Content>
          ))}
          {!projects.length && activeTab === "activity" && (
            <div className="panel p-3 text-xs text-[var(--ctp-overlay1)]">No projects yet. Use + project to watch a GitHub Projects v2 board.</div>
          )}
          <Tabs.Content value="activity" className="panel min-h-0 flex-1 overflow-hidden p-3">
            <Changes changes={changes} syncRuns={syncRuns} />
          </Tabs.Content>
          <Tabs.Content value="summaries" className="panel min-h-0 flex-1 overflow-y-auto p-3">
            <Summaries summaries={summaries} />
          </Tabs.Content>
          <Tabs.Content value="settings" className="panel min-h-0 flex-1 overflow-y-auto p-3">
            <SettingsForm settings={settings} setSettings={(nextSettings) => dispatch({ type: "settings", settings: nextSettings })} refresh={refresh} setMessage={setMessage} />
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <ProjectDialog
        open={ui.projectDialogOpen}
        editingProject={ui.editingProject}
        onOpenChange={(nextOpen) => {
          dispatchUi({ type: "setProjectDialogOpen", open: nextOpen });
        }}
        onSaved={async (savedMessage) => {
          await refresh();
          setMessage(savedMessage);
        }}
      />
    </main>
  );
}

function ProjectBoard({ project, refreshKey, onEdit, onDelete }: { project: Project; refreshKey: number; onEdit: () => void; onDelete: () => Promise<void> }) {
  const [boardState, dispatchBoard] = useReducer(projectBoardReducer, initialProjectBoardState);
  const { board, error, loading, fetchId, showClosedPrs, selectedIssueRepo } = boardState;
  const prSwitchId = `pr-state-switch-${project.id}`;
  const issueRepo = selectedIssueRepo || board?.repositories[0] || "";

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
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        dispatchBoard({ type: "failed", error: loadError instanceof Error ? loadError.message : "Failed to load board" });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, fetchId, refreshKey]);

  const load = () => {
    dispatchBoard({ type: "load" });
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{projectLabel(project)}</h2>
        <span className="text-xs text-[var(--ctp-overlay1)]">
          {project.owner_type}/{project.owner_login} #{project.project_number}
          {board?.lastSyncedAt ? ` · synced ${relativeTime(board.lastSyncedAt)} ago` : ""}
        </span>
        <div className="ml-auto flex gap-1">
          {board && board.repositories.length > 1 && (
            <select
              className="input w-44 py-1 text-xs"
              value={issueRepo}
              aria-label="Repository for new issue"
              onChange={(event) => dispatchBoard({ type: "selectedIssueRepo", value: event.target.value })}
            >
              {board.repositories.map((repository) => (
                <option key={repository} value={repository}>{repository}</option>
              ))}
            </select>
          )}
          <button type="button" className="btn" onClick={openNewIssue} disabled={!issueRepo}>New issue</button>
          <button type="button" className="btn" onClick={load} disabled={loading}>{loading ? "Loading..." : "Reload"}</button>
          <button type="button" className="btn" onClick={onEdit}>Edit</button>
          <AlertDialog.Root>
            <AlertDialog.Trigger asChild>
              <button type="button" className="btn btn-danger">Delete</button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="dialog-overlay" />
              <AlertDialog.Content className="dialog-content">
                <AlertDialog.Title className="text-sm font-semibold">Delete {projectLabel(project)}?</AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-xs text-[var(--ctp-subtext0)]">
                  This removes the project config and stored child records.
                </AlertDialog.Description>
                <div className="mt-4 flex justify-end gap-2">
                  <AlertDialog.Cancel className="btn">Cancel</AlertDialog.Cancel>
                  <AlertDialog.Action className="btn btn-danger" onClick={onDelete}>Delete</AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </div>

      {error && <div className="shrink-0 bg-[var(--ctp-mantle)] px-2 py-1 text-xs text-[var(--ctp-red)]">{error}</div>}

      <Group orientation="horizontal" className="min-h-0 flex-1 gap-2">
        <Panel defaultSize={74} minSize={35} className="min-w-0">
          <Group orientation="horizontal" className="h-full min-w-0 gap-1 overflow-x-auto">
          {board && !board.columns.length && (
            <div className="text-xs text-[var(--ctp-overlay1)]">No board items synced yet. Run a sync to pull the project.</div>
          )}
          {board?.columns.map((column, index) => (
            <ColumnPanel key={column.name} column={column} showHandle={index < board.columns.length - 1} />
          ))}
          </Group>
        </Panel>

        <ResizeHandle orientation="horizontal" />

        <Panel defaultSize={26} minSize={18} maxSize={55} className="min-w-72">
          <Group orientation="vertical" className="h-full min-h-0 gap-1">
            <Panel defaultSize={50} minSize={50} className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-baseline gap-2 px-2 py-1">
                  <h3 className="shrink-0 whitespace-nowrap text-xs font-semibold text-[var(--ctp-peach)]">Open issues</h3>
                  <span className="truncate text-[0.65rem] text-[var(--ctp-overlay0)]">
                    {board ? (board.repositories.length ? board.repositories.join(", ") : "no repos linked") : ""}
                  </span>
                </div>
                {board?.issuesError && <div className="shrink-0 bg-[var(--ctp-mantle)] px-2 py-1 text-xs text-[var(--ctp-red)]">{board.issuesError}</div>}
                {board && !board.issuesError && !board.openIssues.length && (
                  <div className="px-2 text-xs text-[var(--ctp-overlay1)]">{board.repositories.length ? "No open issues." : "Link repos to this project to list their open issues."}</div>
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
                  {board?.openIssues.map((issue) => <IssueRow key={issue.id} issue={issue} />)}
                </div>
              </div>
            </Panel>

            <ResizeHandle orientation="vertical" />

            <Panel defaultSize={50} minSize={18} className="min-h-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-center gap-2 px-2 py-1">
                  <h3 className="text-xs font-semibold text-[var(--ctp-mauve)]">Pull requests</h3>
                  <span className="text-[0.65rem] text-[var(--ctp-overlay0)]">{showClosedPrs ? "closed/merged" : "open"}</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[0.65rem] text-[var(--ctp-subtext0)]" htmlFor={prSwitchId}>
                    Closed
                    <Switch.Root id={prSwitchId} className="switch-root" checked={showClosedPrs} onCheckedChange={(value) => dispatchBoard({ type: "showClosedPrs", value })}>
                      <Switch.Thumb className="switch-thumb" />
                    </Switch.Root>
                  </label>
                </div>
                {board?.prsError && <div className="shrink-0 bg-[var(--ctp-mantle)] px-2 py-1 text-xs text-[var(--ctp-red)]">{board.prsError}</div>}
                {board && !board.prsError && (showClosedPrs ? board.pullRequests.closed : board.pullRequests.open).length === 0 && (
                  <div className="px-2 text-xs text-[var(--ctp-overlay1)]">No {showClosedPrs ? "closed" : "open"} pull requests.</div>
                )}
                <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
                  {(showClosedPrs ? board?.pullRequests.closed : board?.pullRequests.open)?.map((pr) => <PullRequestRow key={pr.id} pullRequest={pr} />)}
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}

function ColumnPanel({ column, showHandle }: { column: { name: string; items: BoardItem[] }; showHandle: boolean }) {
  return (
    <>
      <Panel defaultSize={20} minSize={12} className="min-w-48">
        <div className="board-column flex h-full flex-col">
          <div className="flex shrink-0 items-baseline justify-between px-2 py-1">
            <span className="text-xs font-semibold text-[var(--ctp-lavender)]">{column.name}</span>
            <span className="text-xs text-[var(--ctp-overlay0)]">{column.items.length}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 pb-1">
            {column.items.map((item) => (
              <div key={item.id} className="board-card">
                <div className="truncate text-xs">
                  {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
                </div>
                <div className="mt-0.5 flex gap-1.5 text-[0.65rem] text-[var(--ctp-overlay1)]">
                  {item.repository && <span>{item.repository.split("/")[1]}{item.number ? `#${item.number}` : ""}</span>}
                  <span>{item.type === "PullRequest" ? "PR" : item.type === "DraftIssue" ? "draft" : "issue"}</span>
                  {item.state && <span className={stateClass(item.state)}>{item.state.toLowerCase()}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      {showHandle && <ResizeHandle orientation="horizontal" />}
    </>
  );
}

function ResizeHandle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return <Separator className={`resize-handle resize-handle-${orientation}`} />;
}

function IssueRow({ issue }: { issue: OpenIssue }) {
  return (
    <div className="bg-[var(--ctp-mantle)] px-2 py-1 text-xs">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[var(--ctp-overlay1)]">{issue.repository.split("/")[1]}#{issue.number}</span>
        <a className="truncate" href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.65rem] text-[var(--ctp-overlay0)]">
        {issue.labels.map((label) => (
          <span key={label.name} className="flex items-center gap-1 text-[var(--ctp-subtext0)]">
            <span className="h-2 w-2" style={{ background: `#${label.color}` }} />
            {label.name}
          </span>
        ))}
        {issue.onBoard && <span className="bg-[var(--ctp-surface0)] px-1 text-[var(--ctp-teal)]">board</span>}
        <span className="ml-auto">{issue.author ?? "unknown"} · {relativeTime(issue.updatedAt)}</span>
      </div>
    </div>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: BoardPullRequest }) {
  return (
    <div className="bg-[var(--ctp-mantle)] px-2 py-1 text-xs">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[var(--ctp-overlay1)]">{pullRequest.repository.split("/")[1]}#{pullRequest.number}</span>
        <a className="truncate" href={pullRequest.url} target="_blank" rel="noreferrer">{pullRequest.title}</a>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-[var(--ctp-overlay0)]">
        <span className={stateClass(pullRequest.state)}>{pullRequest.state.toLowerCase()}</span>
        {pullRequest.onBoard && <span className="bg-[var(--ctp-surface0)] px-1 text-[var(--ctp-teal)]">board</span>}
        <span className="ml-auto">{pullRequest.author ?? "unknown"} · {relativeTime(pullRequest.updatedAt)}</span>
      </div>
    </div>
  );
}

function ProjectDialog({
  open,
  editingProject,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editingProject: Project | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, dispatchForm] = useReducer(projectFormReducer, emptyProjectForm);

  useEffect(() => {
    if (!open) return;
    if (editingProject) dispatchForm({ type: "load", project: editingProject });
    else dispatchForm({ type: "reset" });
  }, [open, editingProject]);

  const save = async () => {
    await api(editingProject ? `/api/projects/${editingProject.id}` : "/api/projects", {
      method: editingProject ? "PUT" : "POST",
      body: JSON.stringify({
        ownerType: form.ownerType,
        ownerLogin: form.ownerLogin,
        projectNumber: Number(form.projectNumber),
        title: form.title,
        repositories: parseRepos(form.repos),
      }),
    });
    onOpenChange(false);
    await onSaved(editingProject ? "Project updated" : "Project saved");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="text-sm font-semibold">{editingProject ? "Edit GitHub Project v2" : "Add GitHub Project v2"}</Dialog.Title>
          <div className="mt-3 grid gap-2">
            <label className="block">
              <span className="field-label">Owner type</span>
              <select
                className="input mt-1"
                value={form.ownerType}
                onChange={(event) => dispatchForm({ type: "ownerType", value: event.target.value as "org" | "user" })}
              >
                <option value="org">Org</option>
                <option value="user">User</option>
              </select>
            </label>
            <Input label="Owner login" value={form.ownerLogin} onChange={(value) => dispatchForm({ type: "field", key: "ownerLogin", value })} />
            <Input label="Project number" value={form.projectNumber} onChange={(value) => dispatchForm({ type: "field", key: "projectNumber", value })} />
            <Input label="Display title" value={form.title} onChange={(value) => dispatchForm({ type: "field", key: "title", value })} />
            <label className="field-label" htmlFor="project-repos">Linked repos, one owner/name per line</label>
            <textarea id="project-repos" className="input min-h-24" value={form.repos} onChange={(event) => dispatchForm({ type: "field", key: "repos", value: event.target.value })} placeholder="my-org/private-repo" />
            <div className="flex justify-end gap-2">
              <Dialog.Close className="btn">Cancel</Dialog.Close>
              <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Changes({ changes, syncRuns }: { changes: Change[]; syncRuns: SyncRun[] }) {
  const latestSync = syncRuns[0];
  return (
    <div className="flex h-full flex-col gap-2">
      {latestSync?.error && <div className="shrink-0 bg-[var(--ctp-mantle)] px-2 py-1 text-xs text-[var(--ctp-red)]">Last sync failed: {latestSync.error}</div>}
      <ScrollArea.Root className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea.Viewport className="h-full w-full">
          <div className="flex flex-col gap-px">
            {changes.map((change) => (
              <div key={change.id} className="flex items-center gap-2 bg-[var(--ctp-mantle)] px-2 py-1 text-xs">
                <span className="w-24 shrink-0 text-[var(--ctp-overlay0)]">{relativeTime(change.occurred_at)} ago</span>
                <span className="w-36 shrink-0 truncate text-[var(--ctp-mauve)]">{change.change_type}</span>
                <span className="w-40 shrink-0 truncate text-[var(--ctp-overlay1)]">{change.repository ?? change.project_title ?? ""}</span>
                {change.url ? (
                  <a className="truncate" href={change.url} target="_blank" rel="noreferrer">{change.title}</a>
                ) : (
                  <span className="truncate">{change.title}</span>
                )}
                {change.actor_login && <span className="ml-auto shrink-0 text-[var(--ctp-overlay0)]">{change.actor_login}</span>}
              </div>
            ))}
            {!changes.length && <div className="px-2 py-3 text-xs text-[var(--ctp-overlay1)]">No changes captured yet. Run sync after configuring a token and project.</div>}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar" orientation="vertical"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}

function Summaries({ summaries }: { summaries: Summary[] }) {
  return (
    <div className="flex flex-col gap-2">
      {summaries.map((summary) => (
        <article key={summary.id} className="bg-[var(--ctp-mantle)] p-2">
          <div className="flex items-baseline gap-2 text-[0.65rem] text-[var(--ctp-overlay1)]">
            <span className="text-[var(--ctp-teal)]">{summary.provider}</span>
            <span>{summary.change_count} changes</span>
            <span>{new Date(summary.created_at).toLocaleString()}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold">{summary.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ctp-subtext0)]">{summary.short_body}</p>
          <Dialog.Root>
            <Dialog.Trigger asChild><button type="button" className="btn mt-2">Full summary</button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content w-[min(calc(100vw-2rem),48rem)]">
                <Dialog.Title className="text-sm font-semibold">{summary.title}</Dialog.Title>
                <ScrollArea.Root className="mt-3 h-[60vh] overflow-hidden bg-[var(--ctp-mantle)]">
                  <ScrollArea.Viewport className="h-full w-full p-2">
                    <pre className="whitespace-pre-wrap text-xs leading-5">{summary.body}</pre>
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar className="scrollbar" orientation="vertical"><ScrollArea.Thumb className="scrollbar-thumb" /></ScrollArea.Scrollbar>
                </ScrollArea.Root>
                <div className="mt-3 flex justify-end"><Dialog.Close className="btn">Close</Dialog.Close></div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </article>
      ))}
      {!summaries.length && <div className="text-xs text-[var(--ctp-overlay1)]">No summaries yet.</div>}
    </div>
  );
}

function SettingsForm({ settings, setSettings, refresh, setMessage }: { settings: Settings; setSettings: (settings: Settings) => void; refresh: () => Promise<void>; setMessage: (message: string) => void }) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value });
  const save = async () => {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
    await refresh();
    setMessage("Settings saved");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Settings</h2>
        <button type="button" className="btn btn-primary" onClick={save}>Save settings</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--ctp-lavender)]">GitHub and scheduling</h3>
          <Input label="GitHub token" type="password" value={settings.githubToken} onChange={(value) => update("githubToken", value)} />
          <Input label="Poll interval minutes" value={String(settings.pollIntervalMinutes)} onChange={(value) => update("pollIntervalMinutes", Number(value))} />
          <Input label="Comments per issue/PR poll" value={String(settings.commentPollLimit)} onChange={(value) => update("commentPollLimit", Number(value))} />
          <Input label="Daily summary cron" value={settings.summaryCron} onChange={(value) => update("summaryCron", value)} />
          <Input label="Webhook secret" type="password" value={settings.webhookSecret} onChange={(value) => update("webhookSecret", value)} />
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Summarizers</h3>
          <Input label="Provider order" value={settings.summaryProviderOrder} onChange={(value) => update("summaryProviderOrder", value)} />
          <Input label="LM Studio base URL" value={settings.lmStudioBaseUrl} onChange={(value) => update("lmStudioBaseUrl", value)} />
          <Input label="LM Studio model" value={settings.lmStudioModel} onChange={(value) => update("lmStudioModel", value)} />
          <Input label="Codex command" value={settings.codexCommand} onChange={(value) => update("codexCommand", value)} />
          <Input label="OpenCode command" value={settings.opencodeCommand} onChange={(value) => update("opencodeCommand", value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => api("/api/health/github", { method: "POST" }).then(() => setMessage("GitHub connection OK")).catch((error) => setMessage(error.message))}>Test GitHub</button>
            <button type="button" className="btn" onClick={() => api("/api/health/lmstudio", { method: "POST" }).then(() => setMessage("LM Studio connection OK")).catch((error) => setMessage(error.message))}>Test LM Studio</button>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--ctp-lavender)]">Summary style</h3>
          <label className="sr-only" htmlFor="summary-style">Summary style</label>
          <textarea id="summary-style" className="input min-h-24" value={settings.summaryStyle} onChange={(event) => update("summaryStyle", event.target.value)} />
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Email</h3>
          <Input label="SMTP host" value={settings.smtpHost} onChange={(value) => update("smtpHost", value)} />
          <Input label="SMTP port" value={String(settings.smtpPort)} onChange={(value) => update("smtpPort", Number(value))} />
          <Input label="SMTP user" value={settings.smtpUser} onChange={(value) => update("smtpUser", value)} />
          <Input label="SMTP password" type="password" value={settings.smtpPassword} onChange={(value) => update("smtpPassword", value)} />
          <Input label="Email from" value={settings.emailFrom} onChange={(value) => update("emailFrom", value)} />
          <Input label="Email to" value={settings.emailTo} onChange={(value) => update("emailTo", value)} />
          <button type="button" className="btn" onClick={() => api("/api/notifications/test-email", { method: "POST" }).then(() => setMessage("Test email sent")).catch((error) => setMessage(error.message))}>Test email</button>
          <h3 className="pt-2 text-xs font-semibold text-[var(--ctp-lavender)]">Telegram</h3>
          <Input label="Bot token" type="password" value={settings.telegramBotToken} onChange={(value) => update("telegramBotToken", value)} />
          <Input label="Chat ID" value={settings.telegramChatId} onChange={(value) => update("telegramChatId", value)} />
          <button type="button" className="btn" onClick={() => api("/api/notifications/test-telegram", { method: "POST" }).then(() => setMessage("Test Telegram sent")).catch((error) => setMessage(error.message))}>Test Telegram</button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className="input mt-1" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
