"use client";

import { AlertTriangle, Check, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportStatus } from "@/server/automator";
import { api } from "../utils";
import { mockImportStatus } from "./mocks";
import { ReceiptsBrowser } from "./ReceiptsBrowser";
import { RuleReview } from "./RuleReview";

const POLL_MS = 1500;
const STEPS = ["Get chat data", "Receipts", "Review & merge"] as const;

export function MigrationWizard({ open, onOpenChange, enabled, agentsmd }: { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; agentsmd: string }) {
  const [step, setStep] = useState(0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] w-full flex-col gap-3 sm:max-w-4xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Migrate from chat history</DialogTitle>
          <div className="flex items-center gap-1 pt-1">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                  step === index ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`flex size-4 items-center justify-center rounded-full text-[0.6rem] ${step === index ? "bg-[var(--ctp-mauve)] text-[var(--ctp-base)]" : "bg-[var(--ctp-surface0)]"}`}>
                  {index + 1}
                </span>
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          {step === 0 && <ImportStep enabled={enabled} onDone={() => setStep(1)} />}
          {step === 1 && <ReceiptsBrowser enabled={enabled} />}
          {step === 2 && <RuleReview enabled={enabled} agentsmd={agentsmd} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTIVE_PHASES = new Set(["mining", "reviewing", "synthesizing"]);
function isRunning(status: ImportStatus | null): boolean {
  return !!status && (status.active || ACTIVE_PHASES.has(status.phase));
}

function ImportStep({ enabled, onDone }: { enabled: boolean; onDone: () => void }) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await api<ImportStatus>("/api/automator/import-chats");
      setStatus(next);
      setOffline(false);
      if (!isRunning(next) && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    } catch (pollError) {
      setOffline(true);
      setError(pollError instanceof Error ? pollError.message : "Daemon offline");
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timer.current) return;
    timer.current = setInterval(poll, POLL_MS);
  }, [poll]);

  // On open, read current status so a still-running import (started earlier, then
  // the panel was closed) resumes its live view instead of looking idle.
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      await poll();
    })();
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, poll]);

  useEffect(() => {
    if (isRunning(status)) startPolling();
  }, [status, startPolling]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const next = await api<ImportStatus>("/api/automator/import-chats", { method: "POST" });
      setStatus(next);
      setOffline(false);
      startPolling();
    } catch (startError) {
      // 409 = an import is already running; fall back to polling its status.
      const message = startError instanceof Error ? startError.message : "Failed to start import";
      setError(message);
      await poll();
      if (isRunning(status)) startPolling();
    } finally {
      setStarting(false);
    }
  };

  if (!enabled) {
    return (
      <Offline reason="AgentAutomator is disabled. Enable it in Settings → Agent automator to import your chat history." onSample={() => setStatus(mockImportStatus)} status={status} />
    );
  }
  if (offline && !status) {
    return <Offline reason={error ?? "Daemon offline."} onRetry={poll} onSample={() => setStatus(mockImportStatus)} status={status} />;
  }

  const running = isRunning(status);
  const done = status?.phase === "done";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="text-xs text-muted-foreground">
        Mines your local Claude Code and Codex transcripts for frustration moments, reviews them, and synthesizes candidate rules. Mining takes seconds;
        the review pass takes minutes. You can close this panel — the import keeps running on the daemon.
      </p>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={starting || running} onClick={start}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {running ? "Import running…" : starting ? "Starting…" : done ? "Re-run import" : "Start import"}
        </Button>
        {done && (
          <Button type="button" size="sm" variant="secondary" onClick={onDone}>
            View receipts
          </Button>
        )}
      </div>

      {error && !running && (
        <div className="flex items-center gap-1.5 rounded-md bg-[var(--ctp-peach)]/10 px-2 py-1 text-xs text-[var(--ctp-peach)]">
          <AlertTriangle className="size-3 shrink-0" /> {error}
        </div>
      )}

      {status && <PhaseTracker status={status} />}
    </div>
  );
}

const PHASE_ORDER = ["mining", "reviewing", "synthesizing", "done"] as const;
const PHASE_LABEL: Record<string, string> = {
  mining: "Mining sessions",
  reviewing: "Reviewing candidates",
  synthesizing: "Synthesizing rules",
  done: "Done",
};

function PhaseTracker({ status }: { status: ImportStatus }) {
  const currentIndex = PHASE_ORDER.indexOf(status.phase as (typeof PHASE_ORDER)[number]);
  const stats = status.stats ?? {};
  const rateLimitSeconds = remainingSeconds(status.rateLimitedUntil);

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-[var(--ctp-mantle)] p-3">
      <ol className="space-y-1.5">
        {PHASE_ORDER.map((phase, index) => {
          const reached = currentIndex >= index && currentIndex >= 0;
          const active = status.phase === phase && phase !== "done";
          const complete = currentIndex > index || (phase === "done" && status.phase === "done");
          return (
            <li key={phase} className="flex items-center gap-2 text-xs">
              <span
                className="flex size-4 shrink-0 items-center justify-center rounded-full"
                style={{ background: complete ? "var(--ctp-green)" : active ? "var(--ctp-yellow)" : "var(--ctp-surface0)" }}
              >
                {complete ? <Check className="size-2.5 text-[var(--ctp-base)]" /> : active ? <Loader2 className="size-2.5 animate-spin text-[var(--ctp-base)]" /> : null}
              </span>
              <span className={reached ? "text-foreground" : "text-muted-foreground"}>{PHASE_LABEL[phase] ?? phase}</span>
              {phase === "reviewing" && active && typeof stats.batchTotal === "number" && (
                <span className="text-[0.65rem] text-muted-foreground">
                  batch {stats.batchIndex ?? 0}/{stats.batchTotal}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {rateLimitSeconds > 0 && (
        <div className="rounded bg-[var(--ctp-peach)]/10 px-2 py-1 text-[0.65rem] text-[var(--ctp-peach)]">
          Rate-limited — resuming in ~{rateLimitSeconds}s
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-muted-foreground">
        {typeof stats.sessionsScanned === "number" && <span>{stats.sessionsScanned} sessions scanned</span>}
        {typeof stats.candidatesFound === "number" && <span>{stats.candidatesFound} candidates found</span>}
        {typeof stats.lessonsSynthesized === "number" && <span>{stats.lessonsSynthesized} lessons synthesized</span>}
      </div>

      {status.message && <p className="text-[0.65rem] text-muted-foreground">{status.message}</p>}
      {status.error && <p className="text-[0.65rem] text-destructive">{status.error}</p>}
    </div>
  );
}

function remainingSeconds(iso?: string | null): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

function Offline({ reason, onRetry, onSample, status }: { reason: string; onRetry?: () => void; onSample: () => void; status: ImportStatus | null }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <div className="flex items-center gap-1.5 text-[var(--ctp-peach)]">
        <AlertTriangle className="size-4" />
        <span className="text-sm font-semibold">Import unavailable</span>
      </div>
      <p className="max-w-md text-xs text-muted-foreground">{reason}</p>
      <div className="flex gap-2 pt-1">
        {onRetry && (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {!status && (
          <Button type="button" variant="outline" size="sm" onClick={onSample}>
            Preview with sample data
          </Button>
        )}
      </div>
    </div>
  );
}
