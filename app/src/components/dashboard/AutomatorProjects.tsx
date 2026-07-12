"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AutomatorProject } from "./types";
import { api } from "./utils";

function triggerText(project: AutomatorProject) { return Object.entries(project.triggerColumns).map(([column, autonomy]) => `${column}=${autonomy}`).join("\n"); }
function parseTriggers(value: string): AutomatorProject["triggerColumns"] {
  const result: AutomatorProject["triggerColumns"] = {};
  for (const line of value.split("\n")) {
    const [column, autonomy] = line.split("=").map((part) => part.trim());
    if (column && (autonomy === "supervised" || autonomy === "full_auto")) result[column] = autonomy;
  }
  return result;
}

export function AutomatorProjects({ enabled, legacyRepoPaths, legacyTriggers }: { enabled: boolean; legacyRepoPaths: string; legacyTriggers: string }) {
  const [projects, setProjects] = useState<AutomatorProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { if (!enabled) return; try { setProjects(await api<AutomatorProject[]>("/api/automator/projects")); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Could not load daemon projects"); } }, [enabled]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const patch = (repoPath: string, change: Partial<AutomatorProject>) => setProjects((rows) => rows.map((row) => row.repoPath === repoPath ? { ...row, ...change } : row));
  const save = async (project: AutomatorProject) => { setBusy(project.repoPath); try { const saved = await api<AutomatorProject>("/api/automator/projects", { method: "POST", body: JSON.stringify(project) }); setProjects((rows) => rows.map((row) => row.repoPath === project.repoPath ? saved : row)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Policy save failed"); } finally { setBusy(null); } };
  const importLegacy = async () => {
    const mappings = legacyRepoPaths.split("\n").flatMap((line) => { const at = line.indexOf("="); const githubRepo = line.slice(0, at).trim(); const repoPath = line.slice(at + 1).trim(); return at > 0 && githubRepo && repoPath ? [{ githubRepo, repoPath }] : []; });
    const triggerColumns = parseTriggers(legacyTriggers);
    if (!mappings.length || !Object.keys(triggerColumns).length) { setError("Legacy repo paths and trigger columns are both required for import"); return; }
    setBusy("legacy");
    try {
      for (const mapping of mappings) await api("/api/automator/projects", { method: "POST", body: JSON.stringify({ ...mapping, prPolicy: "approval", maxParallel: 6, stackGate: "validated_approved", triggerColumns }) });
      await load(); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Legacy import failed"); }
    finally { setBusy(null); }
  };

  return <div className="space-y-2 rounded-md border border-border p-2">
    <div className="flex items-center"><div><h4 className="text-xs font-semibold">Daemon project policy</h4><p className="text-[0.65rem] text-muted-foreground">AgentAutomator is authoritative for PR policy, concurrency, stacking, and trigger columns.</p></div><Button className="ml-auto" size="xs" variant="secondary" onClick={load}>Refresh</Button></div>
    {error && <p className="text-xs text-destructive">{error}</p>}
    {projects.map((project) => <div key={project.repoPath} className="grid gap-2 rounded bg-[var(--ctp-mantle)] p-2 lg:grid-cols-2">
      <div className="space-y-1"><div className="text-xs font-semibold">{project.githubRepo}</div><div className="truncate font-mono text-[0.6rem] text-muted-foreground">{project.repoPath}</div><Label>PR policy</Label><Select value={project.prPolicy} onValueChange={(value) => patch(project.repoPath, { prPolicy: value as AutomatorProject["prPolicy"] })}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approval">approval</SelectItem><SelectItem value="auto">auto</SelectItem></SelectContent></Select><Label>Stack gate</Label><Select value={project.stackGate} onValueChange={(value) => patch(project.repoPath, { stackGate: value as AutomatorProject["stackGate"] })}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="validated_approved">validated + approved</SelectItem><SelectItem value="merged">merged</SelectItem></SelectContent></Select></div>
      <div className="space-y-1"><Label>Max parallel</Label><Input type="number" min={1} max={32} value={project.maxParallel} onChange={(event) => patch(project.repoPath, { maxParallel: Number(event.target.value) })} /><Label>Trigger columns</Label><Textarea className="min-h-20 font-mono text-xs" value={triggerText(project)} onChange={(event) => patch(project.repoPath, { triggerColumns: parseTriggers(event.target.value) })} /><Button size="xs" disabled={busy === project.repoPath} onClick={() => save(project)}>Save policy</Button></div>
    </div>)}
    {enabled && projects.length === 0 && !error && <p className="text-xs text-muted-foreground">No daemon projects configured. Create them in AgentAutomator or import the legacy mappings below.</p>}
    {(legacyRepoPaths.trim() || legacyTriggers.trim()) && <div className="flex items-center gap-2 rounded border border-[var(--ctp-yellow)]/40 p-2"><div className="text-[0.65rem] text-muted-foreground">Legacy mappings are still saved in Githubers. Importing creates approval-gated daemon policy rows; it does not delete the legacy values.</div><Button className="ml-auto shrink-0" size="xs" variant="secondary" disabled={busy !== null} onClick={importLegacy}>Import legacy policy</Button></div>}
  </div>;
}
