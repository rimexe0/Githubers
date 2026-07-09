// The multiplexed WebSocket envelope shared with the AgentAutomator daemon
// (source of truth: AgentAutomator#3). One socket carries many logical channels;
// every frame is `{ channel, type, payload, seq }`.

import { runStateMeta } from "../utils";

// term:<n> | run:<project>:<id> | chat:<id> | rpc
export type Channel = string;

// Down = daemon→client, Up = client→daemon. Kept as string unions so an
// unknown future type degrades to a no-op instead of a parse error.
export type DownType = "stdout" | "stderr" | "status" | "permission-request" | "rpc-response" | "event";
export type UpType = "stdin" | "resize" | "interrupt" | "kill" | "answer" | "rpc-request" | "subscribe";

export type Envelope<P = unknown> = {
  channel: Channel;
  type: DownType | UpType | (string & {});
  payload: P;
  seq?: number;
};

// --- payload shapes we read (all defensive; the daemon owns the contract) ----

export type StatusPayload = {
  // Coarse lifecycle from the run channel: running | waiting-for-input | failed | done.
  // May also carry the daemon's detailed state string (BUILDING, AWAITING_APPROVAL…).
  status?: string;
  state?: string;
  error?: string | null;
  prUrl?: string | null;
  label?: string;
};

// A choice on a permission request (daemon shape: PermissionBroker.PermissionOption).
export type PermissionOption = { value: string; label?: string };

export type PermissionPayload = {
  id?: string;
  // Daemon sends the prompt as `text`; `question`/`prompt` tolerated as aliases.
  text?: string;
  question?: string;
  prompt?: string;
  // Objects, not bare strings; when absent the UI offers Approve / Deny.
  options?: PermissionOption[];
  runId?: string;
};

// --- channel helpers ---------------------------------------------------------

export function isRunChannel(channel: Channel): boolean {
  return channel.startsWith("run:");
}

// run:<project>:<id> — project may itself contain a slash (owner/repo), so the
// id is everything after the LAST colon and project is the middle segment(s).
export function parseRunChannel(channel: Channel): { project: string; id: string } | null {
  if (!isRunChannel(channel)) return null;
  const rest = channel.slice("run:".length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return { project: "", id: rest };
  return { project: rest.slice(0, lastColon), id: rest.slice(lastColon + 1) };
}

// --- attention / status meta -------------------------------------------------

export type StatusMeta = { label: string; color: string; needsHuman: boolean; running: boolean };

// Normalize either vocabulary (the WS coarse status or the daemon's detailed
// enum) into one shape. Coarse WS words are handled here; everything else
// delegates to runStateMeta so colours match the runs panel and board badges.
export function statusMeta(status: string | null | undefined): StatusMeta {
  const s = (status ?? "").toLowerCase();
  if (s === "waiting-for-input" || s === "waiting" || s === "blocked")
    return { label: "waiting", color: "var(--ctp-peach)", needsHuman: true, running: false };
  if (s === "failed" || s === "error")
    return { label: "failed", color: "var(--ctp-red)", needsHuman: true, running: false };
  if (s === "running")
    return { label: "running", color: "var(--ctp-yellow)", needsHuman: false, running: true };
  if (s === "done" || s === "completed")
    return { label: "done", color: "var(--ctp-green)", needsHuman: false, running: false };
  if (s === "" || s === "idle")
    return { label: "idle", color: "var(--ctp-overlay1)", needsHuman: false, running: false };
  // Detailed daemon enum (BUILDING, AWAITING_APPROVAL, …).
  const meta = runStateMeta(status ?? null);
  const running = ["building", "validating", "reviewing", "fixing", "planning", "preflighting"].includes(meta.label);
  return { label: meta.label, color: meta.color, needsHuman: meta.needsHuman, running };
}

// Sort key: lower = more urgent. Runs that need a human float to the top;
// then active/streaming; then everything idle/done. Ties break on recency.
export function attentionRank(meta: StatusMeta): number {
  if (meta.needsHuman) return 0;
  if (meta.running) return 1;
  return 2;
}
