"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportCandidate, ImportLesson } from "@/server/automator";
import { relativeTime, repoAccent } from "../utils";
import { api } from "../utils";
import { mockCandidates, mockLessons } from "./mocks";

type LoadState = "idle" | "loading" | "ready" | "offline";

// Match a synthesized lesson to the receipt that earned it — by explicit
// candidateId when the daemon supplies it, else by the verbatim message.
function lessonFor(candidate: ImportCandidate, lessons: ImportLesson[]): ImportLesson | undefined {
  return lessons.find(
    (lesson) =>
      (lesson.candidateId && candidate.id && lesson.candidateId === candidate.id) ||
      (lesson.userMessage && lesson.userMessage === candidate.userMessage),
  );
}

export function ReceiptsBrowser({ enabled }: { enabled: boolean }) {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [lessons, setLessons] = useState<ImportLesson[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usingSample, setUsingSample] = useState(false);
  const [project, setProject] = useState("all");
  const [signal, setSignal] = useState("all");
  const [source, setSource] = useState("all");

  const load = useCallback(async () => {
    setState("loading");
    try {
      // Fetch the full set once and filter client-side — the receipts never
      // touch our server, and facet options come straight from the data.
      const [nextCandidates, nextLessons] = await Promise.all([
        api<ImportCandidate[]>("/api/automator/import-chats/candidates"),
        api<ImportLesson[]>("/api/automator/import-chats/lessons").catch(() => [] as ImportLesson[]),
      ]);
      setCandidates(nextCandidates);
      setLessons(nextLessons);
      setUsingSample(false);
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
    setCandidates(mockCandidates);
    setLessons(mockLessons);
    setUsingSample(true);
    setError(null);
    setState("ready");
  };

  const projects = useMemo(() => Array.from(new Set(candidates.map((c) => c.project).filter(Boolean))).sort(), [candidates]);
  const signals = useMemo(() => Array.from(new Set(candidates.flatMap((c) => c.signals ?? []))).sort(), [candidates]);
  const sources = useMemo(() => Array.from(new Set(candidates.map((c) => c.source).filter(Boolean))).sort(), [candidates]);

  const filtered = useMemo(
    () =>
      candidates.filter(
        (c) =>
          (project === "all" || c.project === project) &&
          (source === "all" || c.source === source) &&
          (signal === "all" || (c.signals ?? []).includes(signal)),
      ),
    [candidates, project, source, signal],
  );

  if (!enabled) return <DaemonOffline reason="AgentAutomator is disabled. Enable it in Settings → Agent automator." onSample={loadSample} />;
  if (state === "offline") return <DaemonOffline reason={error ?? "Daemon offline."} onRetry={load} onSample={loadSample} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Project" value={project} onChange={setProject} options={projects} />
        <FilterSelect label="Signal" value={signal} onChange={setSignal} options={signals} />
        <FilterSelect label="Source" value={source} onChange={setSource} options={sources} />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {candidates.length}
        </span>
        {usingSample && (
          <span className="rounded bg-[var(--ctp-yellow)]/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ctp-yellow)]">
            sample data
          </span>
        )}
        <Button type="button" variant="secondary" size="xs" className="ml-auto" onClick={load} disabled={state === "loading"}>
          <RefreshCw className={`size-3 ${state === "loading" ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <p className="text-[0.65rem] text-muted-foreground">
        Verbatim quotes from your chat history, rendered in your browser only — never stored on the Githubers server.
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {state === "loading" && candidates.length === 0 && <div className="px-1 py-4 text-center text-xs text-muted-foreground">Loading receipts…</div>}
        {state === "ready" && filtered.length === 0 && (
          <div className="px-1 py-6 text-center text-xs text-muted-foreground">
            {candidates.length === 0 ? "No receipts yet. Run an import to mine your chat history." : "No receipts match these filters."}
          </div>
        )}
        {filtered.map((candidate, index) => (
          <ReceiptCard key={candidate.id ?? `${candidate.timestamp}-${index}`} candidate={candidate} lesson={lessonFor(candidate, lessons)} />
        ))}
      </div>
    </div>
  );
}

function ReceiptCard({ candidate, lesson }: { candidate: ImportCandidate; lesson?: ImportLesson }) {
  const accent = repoAccent(candidate.project || candidate.source);
  return (
    <div className="rounded-md border border-border bg-[var(--ctp-mantle)] p-2 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide" style={{ background: `color-mix(in oklab, ${accent} 18%, transparent)`, color: accent }}>
          {candidate.source}
        </span>
        {candidate.project && <span className="font-semibold text-foreground">{candidate.project}</span>}
        {candidate.timestamp && <span className="text-[0.6rem] text-muted-foreground">{relativeTime(candidate.timestamp)} ago</span>}
        {typeof candidate.score === "number" && <span className="ml-auto text-[0.6rem] text-muted-foreground">score {candidate.score.toFixed(2)}</span>}
      </div>

      {candidate.assistantBefore && (
        <div className="mb-1.5">
          <span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">Agent was doing</span>
          <p className="mt-0.5 line-clamp-3 text-[0.7rem] text-muted-foreground">{candidate.assistantBefore}</p>
        </div>
      )}

      <div className="mb-1.5 border-l-2 border-[var(--ctp-peach)] pl-2">
        <span className="text-[0.6rem] uppercase tracking-wide text-[var(--ctp-peach)]">You said</span>
        <p className="mt-0.5 whitespace-pre-wrap text-[0.72rem] text-foreground">{candidate.userMessage}</p>
      </div>

      {candidate.signals?.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {candidate.signals.map((s) => (
            <span key={s} className="rounded bg-secondary px-1 py-0.5 text-[0.55rem] text-secondary-foreground">
              {s}
            </span>
          ))}
        </div>
      )}

      {lesson ? (
        <div className="rounded bg-[var(--ctp-base)] p-1.5">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className="text-[0.6rem] uppercase tracking-wide text-[var(--ctp-green)]">Learned</span>
            <span className="rounded bg-[var(--ctp-surface0)] px-1 py-0.5 text-[0.55rem] text-muted-foreground">{lesson.scope}</span>
            {lesson.category && <span className="rounded bg-[var(--ctp-surface0)] px-1 py-0.5 text-[0.55rem] text-muted-foreground">{lesson.category}</span>}
          </div>
          <p className="text-[0.7rem] text-foreground">{lesson.rule}</p>
        </div>
      ) : (
        <p className="text-[0.6rem] italic text-muted-foreground">No rule synthesized from this one.</p>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-7 text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: all</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DaemonOffline({ reason, onRetry, onSample, sampled }: { reason: string; onRetry?: () => void; onSample?: () => void; sampled?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-2">
        <div className="flex items-center justify-center gap-1.5 text-[var(--ctp-peach)]">
          <AlertTriangle className="size-4" />
          <span className="text-sm font-semibold">Daemon unavailable</span>
        </div>
        <p className="text-xs text-muted-foreground">{reason}</p>
        <p className="text-[0.65rem] text-muted-foreground">
          Chat-history import needs the AgentAutomator daemon running on the machine that holds your transcripts.
        </p>
        <div className="flex justify-center gap-2 pt-1">
          {onRetry && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
          {onSample && !sampled && (
            <Button type="button" variant="outline" size="sm" onClick={onSample}>
              Preview with sample data
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
