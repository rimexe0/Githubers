"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Menu, X } from "lucide-react";
import { useEffect, useReducer, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AgentRuns } from "./dashboard/AgentRuns";
import { Briefing } from "./dashboard/Briefing";
import { Monitor } from "./dashboard/monitor/Monitor";
import { ProjectBoard } from "./dashboard/ProjectBoard";
import { RepoChat } from "./dashboard/RepoChat";
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
  const [navOpen, setNavOpen] = useState(false);
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
    setNavOpen(false);
  };

  const staticTabLabels: Record<string, string> = {
    briefing: "Briefing",
    chat: "Chat",
    "agent-runs": "Agent runs",
    monitor: "Monitor",
    summaries: "Summaries",
    settings: "Settings",
  };
  const activeProject = projects.find((project) => project.id === activeTab);
  const activeTabLabel = activeProject ? projectLabel(activeProject) : (staticTabLabels[activeTab] ?? "Menu");

  return (
    <main className="h-screen w-full">
      <div className="mx-auto flex h-full w-full max-w-full flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-card px-3 py-1.5">
          <span className="font-semibold tracking-tight text-[var(--ctp-mauve)]">githubers</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
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
          {/* Mobile: a menu button + current-view label instead of a scrolling tab strip. */}
          <div className="relative flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 md:hidden">
            <Button type="button" variant="secondary" size="xs" onClick={() => setNavOpen((open) => !open)} aria-label="Menu">
              {navOpen ? <X className="size-3.5" /> : <Menu className="size-3.5" />}
            </Button>
            <span className="truncate text-sm font-semibold">{activeTabLabel}</span>
            {navOpen && (
              <>
                <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 cursor-default bg-black/20" onClick={() => setNavOpen(false)} />
                <div className="absolute inset-x-0 top-full z-40 max-h-[70vh] overflow-y-auto border-b border-border bg-card p-1 shadow-lg">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => changeTab(project.id)}
                      className={`block w-full truncate rounded px-2 py-2 text-left text-sm ${activeTab === project.id ? "bg-accent font-semibold" : "hover:bg-accent/50"}`}
                    >
                      {projectLabel(project)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      openAddProject();
                      setNavOpen(false);
                    }}
                    className="block w-full rounded px-2 py-2 text-left text-sm text-muted-foreground hover:bg-accent/50"
                  >
                    + project
                  </button>
                  <div className="my-1 h-px bg-border" />
                  {Object.entries(staticTabLabels).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => changeTab(value)}
                      className={`block w-full rounded px-2 py-2 text-left text-sm ${activeTab === value ? "bg-accent font-semibold" : "hover:bg-accent/50"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <Tabs.List className="hidden shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-1 md:flex">
            {projects.map((project) => (
              <Tabs.Trigger key={project.id} value={project.id} className="tab-trigger">
                {projectLabel(project)}
              </Tabs.Trigger>
            ))}
            <button type="button" className="px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={openAddProject}>
              + project
            </button>
            <div className="mx-2 h-4 w-px bg-border" />
            <Tabs.Trigger value="chat" className="tab-trigger">Chat</Tabs.Trigger>
            <Tabs.Trigger value="briefing" className="tab-trigger">Briefing</Tabs.Trigger>
            <Tabs.Trigger value="agent-runs" className="tab-trigger">Agent runs</Tabs.Trigger>
            <Tabs.Trigger value="monitor" className="tab-trigger">Monitor</Tabs.Trigger>
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
          <Tabs.Content value="chat" className="panel min-h-0 flex-1 overflow-hidden p-3">
            <RepoChat settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="briefing" className="panel min-h-0 flex-1 overflow-hidden p-3">
            <Briefing settings={settings} projects={projects} />
          </Tabs.Content>
          <Tabs.Content value="agent-runs" className="panel min-h-0 flex-1 overflow-hidden p-3">
            <AgentRuns settings={settings} />
          </Tabs.Content>
          <Tabs.Content value="monitor" className="panel min-h-0 flex-1 overflow-hidden p-3">
            <Monitor settings={settings} />
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
