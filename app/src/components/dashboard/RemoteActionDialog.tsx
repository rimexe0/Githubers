"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionPreview, RemoteAction } from "@/server/automator";
import { api } from "./utils";

export function RemoteActionDialog({ action, open, onOpenChange, onExecuted }: { action: RemoteAction | null; open: boolean; onOpenChange: (open: boolean) => void; onExecuted: () => void }) {
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !action) return;
    void Promise.resolve().then(() => {
      setPreview(null); setError(null); setBusy(true);
      return api<ActionPreview>("/api/automator/actions/preview", { method: "POST", body: JSON.stringify({ action }) })
        .then(setPreview).catch((e) => setError(e instanceof Error ? e.message : "Preview failed")).finally(() => setBusy(false));
    });
  }, [open, action]);
  const execute = async () => { if (!preview) return; setBusy(true); try { await api("/api/automator/actions/execute", { method: "POST", body: JSON.stringify({ token: preview.token }) }); onExecuted(); onOpenChange(false); } catch (e) { setError(e instanceof Error ? e.message : "Execution failed"); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Confirm remote action</DialogTitle></DialogHeader>{busy && !preview ? <p className="text-xs">Preparing exact command and identity preview…</p> : error ? <p className="text-xs text-destructive">{error}</p> : preview ? <div className="space-y-2 text-xs"><div><div className="font-semibold">Exact command</div><pre className="overflow-auto rounded bg-[var(--ctp-mantle)] p-2">{JSON.stringify(preview.command)}</pre></div><div>Expires {new Date(preview.expiresAt).toLocaleString()}</div>{preview.outgoingCommits.length > 0 && <div><div className="font-semibold">Outgoing commits</div>{preview.outgoingCommits.map((commit) => <div key={commit.hash} className="mt-1 rounded border p-1"><div className="font-mono">{commit.hash.slice(0, 12)} {commit.subject}</div><div>Author: {commit.author}</div><div>Committer: {commit.committer}</div></div>)}</div>}</div> : null}<DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!preview || busy} onClick={execute}>Execute once</Button></DialogFooter></DialogContent></Dialog>;
}
