"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useReducer, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ProjectBoard } from "./dashboard/ProjectBoard";
import { ProjectDialog } from "./dashboard/ProjectDialog";
import { SettingsForm } from "./dashboard/SettingsForm";
import { Summaries } from "./dashboard/Summaries";
import { emptySettings, type Project, type Settings, type Summary, type SyncRun } from "./dashboard/types";
import { api, projectLabel, relativeTime, staticTabs } from "./dashboard/utils";

type DashboardState = {
  settings: Settings;
  projects: Project[];
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

export function Dashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);
  const [ui, dispatchUi] = useReducer(dashboardUiReducer, initialDashboardUiState);
  const [isPending, startTransition] = useTransition();
  const { settings, projects, syncRuns, summaries, message } = state;

  const refresh = async () => {
    const [nextSettings, nextProjects, nextSyncRuns, nextSummaries] = await Promise.all([
      api<Settings>("/api/settings"),
      api<Project[]>("/api/projects"),
      api<SyncRun[]>("/api/sync"),
      api<Summary[]>("/api/summaries"),
    ]);
    dispatch({
      type: "loaded",
      payload: { settings: nextSettings, projects: nextProjects, syncRuns: nextSyncRuns, summaries: nextSummaries },
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
  const activeTab = ui.selectedTab && validTabs.includes(ui.selectedTab) ? ui.selectedTab : (projects[0]?.id ?? "summaries");
  const latestSync = syncRuns[0];

  const changeTab = (value: string) => {
    dispatchUi({ type: "selectTab", value, activeTab });
  };

  return (
    <main className="h-screen w-full">
      <div className="mx-auto flex h-full w-full max-w-full flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5">
          <span className="font-semibold tracking-tight text-[var(--ctp-mauve)]">githubers</span>
          <span className="text-xs text-muted-foreground">
            {latestSync ? `last sync ${relativeTime(latestSync.started_at)} ago, ${latestSync.status}` : "no syncs yet"}
          </span>
          <span className="ml-auto truncate text-xs text-muted-foreground">{message}</span>
          <div className="flex items-center">
            <Button
              type="button"
              size="xs"
              className="rounded-r-none"
              disabled={isPending || !projects.some((project) => project.id === activeTab)}
              onClick={() =>
                runAction("Sync", async () => {
                  await api(`/api/projects/${activeTab}/sync`, { method: "POST" });
                  dispatchUi({ type: "bumpBoardsKey" });
                })
              }
            >
              Sync
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className="rounded-l-none border-l border-border/60"
              disabled={isPending}
              title="Sync all projects"
              onClick={() =>
                runAction("Sync all", async () => {
                  await api("/api/sync", { method: "POST" });
                  dispatchUi({ type: "bumpBoardsKey" });
                })
              }
            >
              All
            </Button>
          </div>
          <Button type="button" variant="secondary" size="xs" disabled={isPending} onClick={() => runAction("Summary", () => api("/api/summaries", { method: "POST" }))}>
            Summarize
          </Button>
        </header>

        <Tabs.Root value={activeTab} onValueChange={changeTab} className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-1">
            {projects.map((project) => (
              <Tabs.Trigger key={project.id} value={project.id} className="tab-trigger">
                {projectLabel(project)}
              </Tabs.Trigger>
            ))}
            <button type="button" className="px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={openAddProject}>
              + project
            </button>
            <div className="mx-2 h-4 w-px bg-border" />
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
