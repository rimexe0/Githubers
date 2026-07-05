"use client";

import { Download, FileSearch, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AgentsmdFile, DaemonConfig, DoctorFinding, DoctorResult } from "@/server/automator";
import { api } from "../utils";
import type { Settings } from "../types";
import { MigrationWizard } from "./MigrationWizard";
import { mockDoctorResult, SAMPLE_AGENTS_MD } from "./mocks";
import { ReceiptsBrowser } from "./ReceiptsBrowser";

// The AGENTS.md section houses the doctor, the migration wizard, and the
// standalone provenance (receipts) browser. It lives inside Settings.
export function AgentsmdSection({ settings }: { settings: Settings }) {
  const enabled = settings.automatorEnabled;
  const [content, setContent] = useState("");
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [doctorState, setDoctorState] = useState<"idle" | "loading">("idle");
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [sampleDoctor, setSampleDoctor] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState<string>("");
  const [files, setFiles] = useState<AgentsmdFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [doctorProfile, setDoctorProfile] = useState<string>("");

  // On open, discover mapped repos + the daemon profile list (for auto-load and
  // the doctor profile picker). Silent-fail keeps the paste path working offline.
  useEffect(() => {
    if (!enabled) return;
    void api<{ repos: string[] }>("/api/automator/chat").then((data) => setRepos(data.repos ?? [])).catch(() => {});
    void api<DaemonConfig>("/api/automator/config")
      .then((cfg) => {
        setProfiles(cfg.profiles ?? []);
        setDoctorProfile((prev) => prev || cfg.importReviewerProfile || "");
      })
      .catch(() => {});
  }, [enabled]);

  const loadFiles = async () => {
    setLoadingFiles(true);
    setDoctorError(null);
    try {
      const qs = repo ? `?repo=${encodeURIComponent(repo)}` : "";
      const found = await api<AgentsmdFile[]>(`/api/automator/agentsmd/files${qs}`);
      setFiles(found);
      // Auto-fill the editor with the first file that has content (project AGENTS.md wins).
      const first = found.find((file) => file.exists && file.content.trim());
      if (first) setContent(first.content);
      else setDoctorError("No AGENTS.md/CLAUDE.md found in that repo or your global locations.");
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : "Could not read files from the daemon");
    } finally {
      setLoadingFiles(false);
    }
  };

  const runDoctor = async () => {
    if (!content.trim()) {
      setDoctorError("Load or paste your AGENTS.md content first.");
      return;
    }
    setDoctorState("loading");
    setDoctorError(null);
    try {
      const result = await api<DoctorResult>("/api/automator/agentsmd/doctor", {
        method: "POST",
        body: JSON.stringify({ content, profile: doctorProfile || undefined }),
      });
      setDoctor(result);
      setSampleDoctor(false);
    } catch (error) {
      setDoctorError(error instanceof Error ? error.message : "Doctor unavailable");
    } finally {
      setDoctorState("idle");
    }
  };

  const previewSample = () => {
    if (!content.trim()) setContent(SAMPLE_AGENTS_MD);
    setDoctor(mockDoctorResult);
    setSampleDoctor(true);
    setDoctorError(null);
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-[var(--ctp-lavender)]">AGENTS.md</h3>
        <span className="text-[0.65rem] text-muted-foreground">Audit your rules file and import learned rules from years of chat history.</span>
        <div className="ml-auto flex gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setReceiptsOpen(true)}>
            <FileSearch className="size-3.5" /> Browse receipts
          </Button>
          <Button type="button" size="sm" onClick={() => setWizardOpen(true)}>
            Migrate from chat history
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Label className="shrink-0">Auto-load from repo</Label>
            <Select value={repo} onValueChange={setRepo} disabled={!enabled}>
              <SelectTrigger size="sm" className="h-7 min-w-40 text-xs">
                <SelectValue placeholder={repos.length ? "select repo" : "global only"} />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="secondary" size="sm" disabled={!enabled || loadingFiles} onClick={loadFiles}>
              <Download className="size-3.5" /> {loadingFiles ? "Loading…" : "Load"}
            </Button>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  disabled={!file.exists || !file.content.trim()}
                  onClick={() => setContent(file.content)}
                  title={file.path}
                  className={`rounded border px-1.5 py-0.5 text-[0.6rem] ${
                    file.exists && file.content.trim() ? "border-border text-foreground hover:bg-accent" : "border-border/50 text-muted-foreground line-through"
                  }`}
                >
                  {file.scope}/{file.tool === "agents" ? "AGENTS.md" : file.tool === "claude" ? "CLAUDE.md" : "codex AGENTS.md"}
                </button>
              ))}
            </div>
          )}
          <Label htmlFor="agentsmd-content">Current AGENTS.md (auto-loaded or pasted)</Label>
          <Textarea
            id="agentsmd-content"
            className="min-h-40 font-mono text-xs"
            placeholder="# AGENTS.md&#10;- your rules here…"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="secondary" size="sm" disabled={doctorState === "loading"} onClick={runDoctor}>
              <Stethoscope className="size-3.5" /> {doctorState === "loading" ? "Running doctor…" : "Run doctor"}
            </Button>
            {profiles.length > 0 && (
              <Select value={doctorProfile} onValueChange={setDoctorProfile}>
                <SelectTrigger size="sm" className="h-7 text-xs">
                  <SelectValue placeholder="doctor model" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile} value={profile}>
                      {profile}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {doctor && <ScoreBadge score={doctor.score} />}
            {sampleDoctor && (
              <span className="rounded bg-[var(--ctp-yellow)]/15 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ctp-yellow)]">sample</span>
            )}
          </div>
          {doctorError && (
            <div className="space-y-1">
              <p className="text-[0.65rem] text-destructive">{doctorError}</p>
              {!enabled || /reach|offline|disabled/i.test(doctorError) ? (
                <Button type="button" variant="outline" size="xs" onClick={previewSample}>
                  Preview with sample data
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <div className="min-h-40 rounded-md border border-border p-2">
          {!doctor ? (
            <div className="flex h-full items-center justify-center text-center text-[0.65rem] text-muted-foreground">
              Run the doctor to score your AGENTS.md and list findings (too long, vague, contradictory, or duplicate rules).
            </div>
          ) : doctor.findings.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-[var(--ctp-green)]">No findings — your AGENTS.md looks clean.</div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-[0.65rem] text-muted-foreground">
                {doctor.findings.length} finding{doctor.findings.length === 1 ? "" : "s"} — each is actionable in the review queue.
              </div>
              {doctor.findings.map((finding, index) => (
                <FindingRow key={index} finding={finding} />
              ))}
            </div>
          )}
        </div>
      </div>

      <MigrationWizard open={wizardOpen} onOpenChange={setWizardOpen} enabled={enabled} agentsmd={content} />

      <Dialog open={receiptsOpen} onOpenChange={setReceiptsOpen}>
        <DialogContent className="flex h-[82vh] w-full flex-col gap-3 sm:max-w-4xl" showCloseButton>
          <DialogHeader>
            <DialogTitle>Frustration receipts</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <ReceiptsBrowser enabled={enabled} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "var(--ctp-green)" : score >= 50 ? "var(--ctp-yellow)" : "var(--ctp-red)";
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
      doctor score {Math.round(score)}
    </span>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  high: "var(--ctp-red)",
  medium: "var(--ctp-peach)",
  low: "var(--ctp-blue)",
};

function FindingRow({ finding }: { finding: DoctorFinding }) {
  const color = SEVERITY_COLOR[finding.severity] ?? "var(--ctp-lavender)";
  return (
    <div className="rounded border border-border bg-[var(--ctp-mantle)] p-1.5 text-xs">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-[0.55rem] font-semibold uppercase tracking-wide" style={{ color }}>
          {finding.severity}
        </span>
      </div>
      {finding.quote && <p className="mb-1 border-l-2 border-border pl-2 font-mono text-[0.65rem] text-muted-foreground">{finding.quote}</p>}
      <p className="text-[0.7rem] text-foreground">{finding.problem}</p>
      {finding.suggestedRewrite && (
        <p className="mt-1 text-[0.68rem] text-[var(--ctp-green)]">
          <span className="text-[0.55rem] uppercase tracking-wide text-muted-foreground">rewrite: </span>
          {finding.suggestedRewrite}
        </p>
      )}
    </div>
  );
}
