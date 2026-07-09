"use client";

import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingRule } from "@/server/automator";
import { api } from "../utils";
import { DaemonOffline } from "./ReceiptsBrowser";
import { mockPendingRules, SAMPLE_AGENTS_MD } from "./mocks";

type LoadState = "idle" | "loading" | "ready" | "offline";
type Decision = "approved" | "rejected";

export function RuleReview({ enabled, agentsmd }: { enabled: boolean; agentsmd: string }) {
  const [rules, setRules] = useState<PendingRule[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usingSample, setUsingSample] = useState(false);
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const next = await api<PendingRule[]>("/api/automator/rules/pending");
      setRules(next);
      setUsingSample(false);
      setDecided({});
      setError(null);
      setState("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not reach the daemon");
      setState("offline");
    }
  }, []);

  useEffect(() => {
    // Defer off the effect body so the first setState lands asynchronously.
    if (enabled) void Promise.resolve().then(load);
  }, [enabled, load]);

  const loadSample = () => {
    setRules(mockPendingRules);
    setUsingSample(true);
    setDecided({});
    setError(null);
    setState("ready");
  };

  const decide = async (id: string, status: Decision, editedText?: string) => {
    setBusyId(id);
    try {
      if (!usingSample) {
        await api(`/api/automator/rules/${encodeURIComponent(id)}/decide`, {
          method: "POST",
          body: JSON.stringify({ status, ...(editedText ? { editedText } : {}) }),
        });
      }
      if (editedText) setRules((prev) => prev.map((r) => (r.id === id ? { ...r, text: editedText } : r)));
      setDecided((prev) => ({ ...prev, [id]: status }));
      setEditingId(null);
      setError(null);
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : "Decision failed");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (rule: PendingRule) => {
    setEditingId(rule.id);
    setEditText(rule.text);
  };

  if (!enabled) return <DaemonOffline reason="AgentAutomator is disabled. Enable it in Settings → Agent automator." onSample={loadSample} />;
  if (state === "offline") return <DaemonOffline reason={error ?? "Daemon offline."} onRetry={load} onSample={loadSample} />;

  const pending = rules.filter((rule) => !decided[rule.id]);
  const sampleAgents = usingSample && !agentsmd.trim() ? SAMPLE_AGENTS_MD : agentsmd;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {pending.length} rule{pending.length === 1 ? "" : "s"} awaiting review
        </span>
        {usingSample && (
          <span className="rounded bg-[var(--ctp-yellow)]/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ctp-yellow)]">sample data</span>
        )}
        <Button type="button" variant="secondary" size="xs" className="ml-auto" onClick={load} disabled={state === "loading"}>
          <RefreshCw className={`size-3 ${state === "loading" ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <p className="text-[0.65rem] text-muted-foreground">
        Approving adds a rule to your git-backed rules store (pending → active). It is <span className="font-semibold">not</span> appended to AGENTS.md — that file is
        re-rendered from the approved set at spawn.
      </p>

      {error && (
        <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>
      )}

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[1.4fr_1fr]">
        {/* Generated rules */}
        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
          {state === "loading" && rules.length === 0 && <div className="px-1 py-4 text-center text-xs text-muted-foreground">Loading rules…</div>}
          {state === "ready" && rules.length === 0 && (
            <div className="px-1 py-6 text-center text-xs text-muted-foreground">No generated rules yet. Run an import to synthesize rules from your history.</div>
          )}
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              decision={decided[rule.id]}
              busy={busyId === rule.id}
              editing={editingId === rule.id}
              editText={editText}
              onEditText={setEditText}
              onStartEdit={() => startEdit(rule)}
              onCancelEdit={() => setEditingId(null)}
              onApprove={() => decide(rule.id, "approved")}
              onApproveEdited={() => decide(rule.id, "approved", editText.trim() || rule.text)}
              onReject={() => decide(rule.id, "rejected")}
            />
          ))}
        </div>

        {/* Current AGENTS.md, for side-by-side comparison */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-[var(--ctp-mantle)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Current AGENTS.md</div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-2 font-mono text-[0.65rem] leading-tight text-muted-foreground">
            {sampleAgents.trim() ? sampleAgents : "Paste your AGENTS.md in the section above to compare."}
          </pre>
        </div>
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  decision,
  busy,
  editing,
  editText,
  onEditText,
  onStartEdit,
  onCancelEdit,
  onApprove,
  onApproveEdited,
  onReject,
}: {
  rule: PendingRule;
  decision?: Decision;
  busy: boolean;
  editing: boolean;
  editText: string;
  onEditText: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onApprove: () => void;
  onApproveEdited: () => void;
  onReject: () => void;
}) {
  return (
    <div className={`rounded-md border border-border bg-[var(--ctp-mantle)] p-2 text-xs transition-opacity ${decision ? "opacity-60" : ""}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-[var(--ctp-surface0)] px-1 py-0.5 text-[0.55rem] uppercase tracking-wide text-muted-foreground">{rule.scope}</span>
        {rule.project && <span className="rounded bg-[var(--ctp-surface0)] px-1 py-0.5 text-[0.55rem] text-muted-foreground">{rule.project}</span>}
        {rule.category && <span className="rounded bg-[var(--ctp-surface0)] px-1 py-0.5 text-[0.55rem] text-muted-foreground">{rule.category}</span>}
        {decision && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide"
            style={{
              background: `color-mix(in oklab, ${decision === "approved" ? "var(--ctp-green)" : "var(--ctp-red)"} 18%, transparent)`,
              color: decision === "approved" ? "var(--ctp-green)" : "var(--ctp-red)",
            }}
          >
            {decision === "approved" ? "added to rules store" : "rejected"}
          </span>
        )}
      </div>

      {editing ? (
        <Textarea className="min-h-16 font-mono text-[0.72rem]" value={editText} onChange={(event) => onEditText(event.target.value)} autoFocus />
      ) : (
        <p className="text-[0.75rem] text-foreground">{rule.text}</p>
      )}

      {rule.fromMessage && !editing && (
        <p className="mt-1.5 border-l-2 border-[var(--ctp-peach)] pl-2 text-[0.65rem] italic text-muted-foreground">
          from you: “{rule.fromMessage}”
        </p>
      )}

      {!decision && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {editing ? (
            <>
              <Button type="button" size="xs" disabled={busy} onClick={onApproveEdited}>
                <Check className="size-3" /> Save &amp; approve
              </Button>
              <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={onCancelEdit}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="xs" disabled={busy} onClick={onApprove}>
                <Check className="size-3" /> Approve
              </Button>
              <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={onStartEdit}>
                <Pencil className="size-3" /> Edit
              </Button>
              <Button type="button" size="xs" variant="destructive" disabled={busy} onClick={onReject}>
                <X className="size-3" /> Reject
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
