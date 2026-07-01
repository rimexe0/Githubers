"use client";

import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AutomatorRun, AutomatorStep, Settings } from "./types";
import { api, relativeTime, runStateMeta } from "./utils";

const POLL_MS = 2500;

// Which actions make sense per state. The daemon is the source of truth and
// will 409 on an illegal action, but this keeps the UI from offering nonsense.
function actionsFor(run: AutomatorRun): string[] {
  const s = run.state.toUpperCase();
  if (s === "AWAITING_APPROVAL") return ["approve", "open-pr", "stop"];
  if (["DONE", "FAILED", "STOPPED"].includes(s)) return [];
  if (s === "PAUSED") return ["resume", "stop", "kill"];
  if (s === "HUMAN_NEEDED") return ["open-pr", "stop", "kill"];
  return ["pause", "stop", "kill"]; // active states
}

function artifactNames(artifacts: unknown): string[] {
  if (Array.isArray(artifacts)) return artifacts.map(String);
  if (artifacts && typeof artifacts === "object") return Object.keys(artifacts as Record<string, unknown>);
  return [];
}

function RunBadge({ state }: { state: string }) {
  const meta = runStateMeta(state);
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide"
      style={{ background: `color-mix(in oklab, ${meta.color} 18%, var(--ctp-mantle))`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

export function AgentRuns({ settings }: { settings: Settings }) {
  const [runs, setRuns] = useState<AutomatorRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = settings.automatorEnabled;

  const loadRuns = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await api<AutomatorRun[]>("/api/automator/runs");
      setRuns(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load runs");
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Defer the first poll off the effect body so setState lands asynchronously.
    void Promise.resolve().then(loadRuns);
    const timer = setInterval(loadRuns, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, loadRuns]);

  const selected = runs.find((run) => run.id === selectedId) ?? null;

  const act = async (id: string, action: string) => {
    setBusy(true);
    try {
      await api(`/api/automator/runs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      await loadRuns();
      setError(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        <div className="max-w-md space-y-2">
          <p className="font-semibold text-foreground">AgentAutomator is not enabled.</p>
          <p>
            Turn it on in <span className="font-semibold">Settings → Agent automator</span>, set the daemon URL + token, map your
            repos to local clone paths, and choose which board columns trigger runs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="text-sm font-semibold">Agent runs</h2>
        <span className="text-xs text-muted-foreground">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
        <Button type="button" variant="secondary" size="xs" className="ml-auto" onClick={loadRuns}>
          <RefreshCw className="size-3" /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2">
        {/* Run list */}
        <div className="flex w-72 shrink-0 flex-col gap-1 overflow-y-auto rounded-md border border-border p-1">
          {runs.length === 0 && <div className="px-1 py-2 text-[0.65rem] text-muted-foreground">No runs yet. Move an issue into a trigger column.</div>}
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelectedId(run.id)}
              className={`flex flex-col gap-1 rounded px-2 py-1.5 text-left transition-colors ${run.id === selectedId ? "bg-accent" : "hover:bg-accent/50"}`}
            >
              <div className="flex items-center gap-1.5">
                <RunBadge state={run.state} />
                {run.awaitingHuman && run.state.toUpperCase() !== "AWAITING_APPROVAL" && (
                  <span className="text-[0.6rem] text-[var(--ctp-peach)]">needs you</span>
                )}
                <span className="ml-auto text-[0.6rem] text-muted-foreground">{relativeTime(run.updatedAt)} ago</span>
              </div>
              <div className="truncate text-xs">
                {run.githubRepo ?? run.id}
                {run.issueNumber != null ? `#${run.issueNumber}` : ""}
              </div>
              <div className="text-[0.6rem] text-muted-foreground">{run.autonomy}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-2">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a run to see its timeline and artifacts.</div>
          ) : (
            <RunDetail run={selected} busy={busy} onAction={act} />
          )}
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, busy, onAction }: { run: AutomatorRun; busy: boolean; onAction: (id: string, action: string) => Promise<void> }) {
  const [steps, setSteps] = useState<AutomatorStep[]>([]);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [prMessage, setPrMessage] = useState<string | null>(null);
  const lastFetched = useRef<string>("");

  // Refetch the timeline + artifacts whenever the run id or its state/updatedAt
  // changes (the poll in the parent keeps `run` fresh).
  useEffect(() => {
    const sig = `${run.id}:${run.state}:${run.updatedAt}`;
    if (sig === lastFetched.current) return;
    lastFetched.current = sig;
    let cancelled = false;

    (async () => {
      try {
        const [stepData, detail] = await Promise.all([
          api<AutomatorStep[]>(`/api/automator/runs/${encodeURIComponent(run.id)}/steps`).catch(() => [] as AutomatorStep[]),
          api<{ run: AutomatorRun; artifacts: unknown }>(`/api/automator/runs/${encodeURIComponent(run.id)}`).catch(() => null),
        ]);
        if (cancelled) return;
        setSteps(Array.isArray(stepData) ? stepData : []);
        const names = detail ? artifactNames(detail.artifacts) : [];
        setArtifacts(names);

        const diffName = names.find((name) => /diff/i.test(name));
        const prName = names.find((name) => /pr-?message/i.test(name));
        const fetchText = (name: string) =>
          fetch(`/api/automator/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(name)}`).then((res) => (res.ok ? res.text() : null));
        setDiff(diffName ? await fetchText(diffName) : null);
        setPrMessage(prName ? await fetchText(prName) : null);
      } catch {
        /* per-artifact failures are non-fatal */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [run.id, run.state, run.updatedAt]);

  const actions = actionsFor(run);

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <RunBadge state={run.state} />
        <span className="font-semibold">
          {run.githubRepo ?? run.id}
          {run.issueNumber != null ? `#${run.issueNumber}` : ""}
        </span>
        {run.prUrl && (
          <a href={run.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ctp-blue)] hover:underline">
            PR <ExternalLink className="size-3" />
          </a>
        )}
        <span className="ml-auto text-[0.65rem] text-muted-foreground">{run.autonomy} · {run.branch ?? "no branch"}</span>
      </div>

      {run.lastError && (
        <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-destructive">
          <span className="font-semibold">Last error: </span>
          {run.lastError}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="xs"
              variant={action === "approve" || action === "open-pr" ? "default" : action === "kill" ? "destructive" : "secondary"}
              disabled={busy}
              onClick={() => onAction(run.id, action)}
            >
              {action === "open-pr" ? "Open PR" : action.charAt(0).toUpperCase() + action.slice(1)}
            </Button>
          ))}
        </div>
      )}

      <section>
        <h3 className="mb-1 font-semibold text-[var(--ctp-lavender)]">Timeline</h3>
        {steps.length === 0 ? (
          <p className="text-[0.65rem] text-muted-foreground">No steps recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {steps.map((step, index) => (
              <li key={`${step.step}-${index}`} className="flex items-start gap-2 rounded bg-[var(--ctp-mantle)] px-2 py-1">
                <span
                  className="mt-0.5 size-2 shrink-0 rounded-full"
                  style={{ background: step.status === "ok" ? "var(--ctp-green)" : step.status === "fail" ? "var(--ctp-red)" : "var(--ctp-yellow)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{step.step}</span>
                    <span className="text-[0.6rem] text-muted-foreground">{step.status}</span>
                    {typeof step.durationMs === "number" && <span className="text-[0.6rem] text-muted-foreground">{Math.round(step.durationMs / 1000)}s</span>}
                  </div>
                  {step.summary && <p className="text-[0.65rem] text-muted-foreground">{step.summary}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {prMessage && (
        <section>
          <h3 className="mb-1 font-semibold text-[var(--ctp-lavender)]">PR message</h3>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--ctp-mantle)] p-2 text-[0.65rem]">{prMessage}</pre>
        </section>
      )}

      {diff && (
        <section>
          <h3 className="mb-1 font-semibold text-[var(--ctp-lavender)]">Diff</h3>
          <pre className="max-h-96 overflow-auto rounded bg-[var(--ctp-mantle)] p-2 font-mono text-[0.65rem] leading-tight">{diff}</pre>
        </section>
      )}

      {artifacts.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold text-[var(--ctp-lavender)]">Artifacts</h3>
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map((name) => (
              <a
                key={name}
                href={`/api/automator/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(name)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[0.65rem] text-muted-foreground hover:text-foreground"
              >
                {name} <ExternalLink className="size-2.5" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
