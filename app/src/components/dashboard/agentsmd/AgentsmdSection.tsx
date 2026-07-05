"use client";

import { FileSearch, Stethoscope } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DoctorFinding, DoctorResult } from "@/server/automator";
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

  const runDoctor = async () => {
    if (!content.trim()) {
      setDoctorError("Paste your AGENTS.md content first.");
      return;
    }
    setDoctorState("loading");
    setDoctorError(null);
    try {
      const result = await api<DoctorResult>("/api/automator/agentsmd/doctor", { method: "POST", body: JSON.stringify({ content }) });
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
          <Label htmlFor="agentsmd-content">Current AGENTS.md (paste to audit)</Label>
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
