"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../utils";

type Capture = { id: number; situation: string; scope: string; project: string | null; occurrences: number; pending_rule_id: number | null };
type Maintenance = { id: number; kind: string; first_rule_id: number; second_rule_id: number; proposed_rule: string | null; status: string };

export function RulesLifecycle({ enabled }: { enabled: boolean }) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [situation, setSituation] = useState(""); const [ruleText, setRuleText] = useState(""); const [scope, setScope] = useState("global"); const [project, setProject] = useState(""); const [rollbackRef, setRollbackRef] = useState("");
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (!enabled) return; try { const [nextCaptures, nextMaintenance] = await Promise.all([api<Capture[]>("/api/automator/rules/repeated"), api<Maintenance[]>("/api/automator/rules/maintenance")]); setCaptures(nextCaptures); setMaintenance(nextMaintenance); setMessage(null); } catch (e) { setMessage(e instanceof Error ? e.message : "Rules lifecycle unavailable"); } }, [enabled]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const run = async (fn: () => Promise<unknown>, success: string) => { setBusy(true); try { await fn(); setMessage(success); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : "Rule operation failed"); } finally { setBusy(false); } };

  return <div className="space-y-3 border-t border-border pt-3">
    <div><h4 className="text-xs font-semibold text-[var(--ctp-lavender)]">Rules lifecycle</h4><p className="text-[0.65rem] text-muted-foreground">Capture repeated corrections, consolidate approved rules, decide maintenance proposals, and restore an exact rules snapshot.</p></div>
    {message && <p className="text-xs text-muted-foreground">{message}</p>}
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="space-y-1 rounded border p-2"><h5 className="text-xs font-semibold">Capture correction</h5><Label>Situation</Label><Textarea value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="What happened and what should change" /><Label>Proposed rule (optional)</Label><Textarea value={ruleText} onChange={(e) => setRuleText(e.target.value)} /><div className="flex gap-2"><Select value={scope} onValueChange={setScope}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">global</SelectItem><SelectItem value="project">project</SelectItem></SelectContent></Select>{scope === "project" && <Input value={project} onChange={(e) => setProject(e.target.value)} placeholder="owner/repo" />}</div><Button size="xs" disabled={busy || !situation.trim()} onClick={() => run(() => api("/api/automator/rules/capture", { method: "POST", body: JSON.stringify({ situation, ruleText: ruleText || undefined, scope, project: project || undefined }) }), "Correction captured")}>Capture</Button></section>
      <section className="space-y-1 rounded border p-2"><div className="flex items-center"><h5 className="text-xs font-semibold">Repeated corrections</h5><Button className="ml-auto" size="xs" variant="secondary" onClick={load}>Refresh</Button></div>{captures.map((capture) => <div key={capture.id} className="rounded bg-[var(--ctp-mantle)] p-1.5 text-xs"><div className="font-semibold">{capture.occurrences} occurrences · {capture.scope}{capture.project ? ` · ${capture.project}` : ""}</div><div>{capture.situation}</div><div className="text-[0.6rem] text-muted-foreground">{capture.pending_rule_id ? `pending rule #${capture.pending_rule_id}` : "no pending rule yet"}</div></div>)}{captures.length === 0 && <p className="text-xs text-muted-foreground">No repeated corrections yet.</p>}</section>
    </div>
    <section className="space-y-2 rounded border p-2"><div className="flex items-center"><div><h5 className="text-xs font-semibold">Consolidation and maintenance</h5><p className="text-[0.65rem] text-muted-foreground">Approved decisions re-render the managed AGENTS blocks used for future worktrees.</p></div><Button className="ml-auto" size="xs" disabled={busy} onClick={() => run(() => api("/api/automator/rules/consolidate", { method: "POST" }), "Consolidation complete")}>Run consolidation</Button></div>{maintenance.map((item) => <MaintenanceCard key={item.id} item={item} busy={busy} decide={(status, editedRule) => run(() => api(`/api/automator/rules/maintenance/${item.id}/decide`, { method: "POST", body: JSON.stringify({ status, editedRule }) }), `Proposal ${status}`)} />)}{maintenance.length === 0 && <p className="text-xs text-muted-foreground">No pending maintenance proposals.</p>}</section>
    <section className="space-y-1 rounded border border-[var(--ctp-peach)]/50 p-2"><h5 className="text-xs font-semibold">Rollback rules snapshot</h5><p className="text-[0.65rem] text-muted-foreground">Creates a new audited snapshot restoring the exact commit below. Obtain the commit from the daemon rules repository history.</p><div className="flex gap-2"><Input className="font-mono" value={rollbackRef} onChange={(e) => setRollbackRef(e.target.value)} placeholder="7-40 character commit hash" /><Button size="xs" variant="destructive" disabled={busy || !/^[a-f\d]{7,40}$/i.test(rollbackRef)} onClick={() => run(() => api("/api/automator/rules/rollback", { method: "POST", body: JSON.stringify({ ref: rollbackRef }) }), `Rolled back to ${rollbackRef}`)}>Rollback exact ref</Button></div></section>
  </div>;
}

function MaintenanceCard({ item, busy, decide }: { item: Maintenance; busy: boolean; decide: (status: string, editedRule?: string) => void }) {
  const [text, setText] = useState(item.proposed_rule ?? "");
  return <div className="rounded bg-[var(--ctp-mantle)] p-2 text-xs"><div className="font-semibold">{item.kind} · rules #{item.first_rule_id} and #{item.second_rule_id}</div><Textarea className="my-1" value={text} onChange={(e) => setText(e.target.value)} placeholder={item.kind === "contradiction" ? "Human-authored replacement required" : "Replacement rule"} /><div className="flex gap-1"><Button size="xs" disabled={busy || !text.trim()} onClick={() => decide("approved", text)}>Approve replacement</Button><Button size="xs" variant="secondary" disabled={busy} onClick={() => decide("rejected")}>Reject</Button></div></div>;
}
