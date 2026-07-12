"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BriefingTask, Project, Settings } from "./types";
import { api, relativeTime } from "./utils";

const STATES = ["all", "new", "dispatched", "in-review", "changes-needed", "ready-to-push", "done", "waiting-for-input"];

export function Briefing({ settings, projects }: { settings: Settings; projects: Project[] }) {
  const repos = useMemo(() => [...new Set(projects.flatMap((project) => project.repositories.filter((repo) => repo.enabled).map((repo) => `${repo.ownerLogin}/${repo.repoName}`)))].sort(), [projects]);
  const [repo, setRepo] = useState("");
  const [state, setState] = useState("all");
  const [tasks, setTasks] = useState<BriefingTask[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!settings.automatorEnabled) return;
    try { setTasks(await api<BriefingTask[]>(`/api/automator/briefing/tasks${state === "all" ? "" : `?state=${encodeURIComponent(state)}`}`)); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Briefing unavailable"); }
  }, [settings.automatorEnabled, state]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Briefing action failed"); }
    finally { setBusy(null); }
  };

  if (!settings.automatorEnabled) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Enable AgentAutomator to use the daily briefing.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Daily briefing</h2>
        <Select value={repo} onValueChange={setRepo}><SelectTrigger size="sm" className="w-52"><SelectValue placeholder="repository" /></SelectTrigger><SelectContent>{repos.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        <Button size="xs" disabled={!repo || busy !== null} onClick={() => act("sync", () => api("/api/automator/briefing/sync", { method: "POST", body: JSON.stringify({ repo }) }))}><RefreshCw className="size-3" /> Sync</Button>
        <Button size="xs" variant="secondary" disabled={busy !== null || !tasks.some((task) => task.state === "new")} onClick={() => act("dispatch-all", () => api("/api/automator/briefing/dispatch-all", { method: "POST" }))}>Dispatch all new</Button>
        <Select value={state} onValueChange={setState}><SelectTrigger size="sm" className="ml-auto w-44"><SelectValue /></SelectTrigger><SelectContent>{STATES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
      </div>
      {error && <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}
      <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => <TaskCard key={task.id} task={task} busy={busy === task.id} onAction={(action, body) => act(task.id, () => api(`/api/automator/briefing/tasks/${encodeURIComponent(task.id)}/${action}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }))} />)}
        {tasks.length === 0 && <div className="text-xs text-muted-foreground">No briefing tasks in this state.</div>}
      </div>
    </div>
  );
}

function TaskCard({ task, busy, onAction }: { task: BriefingTask; busy: boolean; onAction: (action: string, body?: unknown) => void }) {
  return <article className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-xs">
    <div className="flex items-center gap-2"><span className="rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-semibold">{task.state}</span><span className="text-muted-foreground">{task.reason}</span><span className="ml-auto">{relativeTime(task.updatedAt)}</span></div>
    <a href={task.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{task.repo}#{task.number} {task.title} <ExternalLink className="inline size-3" /></a>
    {task.summary && <p className="text-muted-foreground">{task.summary}</p>}
    {task.contextPack && <details><summary className="cursor-pointer text-muted-foreground">Context pack</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[0.6rem]">{JSON.stringify(task.contextPack, null, 2)}</pre></details>}
    <div className="mt-auto flex flex-wrap gap-1"><Button size="xs" variant="secondary" disabled={busy} onClick={() => onAction("context")}>Context</Button><Button size="xs" variant="secondary" disabled={busy} onClick={() => onAction("annotate")}>Annotate</Button><Button size="xs" disabled={busy || task.dispatchCount >= 2} onClick={() => onAction("dispatch")}>Dispatch ({task.dispatchCount}/2)</Button>{task.state !== "done" && <Button size="xs" variant="ghost" disabled={busy} onClick={() => onAction("state", { state: "done" })}>Done</Button>}</div>
  </article>;
}
