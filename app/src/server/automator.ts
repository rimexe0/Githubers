import { query } from "@/db/client";
import { fetchIssueBodies } from "@/server/github";
import { getSettings } from "@/server/settings";

// --- Contract types (camelCase Run object, see AgentAutomator/API_CONTRACT.md) ---

export type AutomatorRun = {
  id: string;
  state: string;
  awaitingHuman: boolean;
  autonomy: string;
  repoPath: string | null;
  githubRepo: string | null;
  issueNumber: number | null;
  branch: string | null;
  baseRef: string | null;
  dependsOn: unknown[];
  failedCycleCount: number;
  activeStep?: string | null;
  prUrl: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Autonomy = "supervised" | "full_auto";

export type AutomatorConfig = {
  enabled: boolean;
  baseUrl: string;
  token: string;
  repoPaths: Map<string, string>; // "owner/repo" -> local clone path
  triggers: Map<string, Autonomy>; // board column name -> autonomy
};

// Parse the newline "key=value" settings text into a map. Keys keep their case
// (column names are case-sensitive on the board); values are trimmed.
function parseMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && value) map.set(key, value);
  }
  return map;
}

export async function getAutomatorConfig(): Promise<AutomatorConfig> {
  const settings = await getSettings();
  const triggers = new Map<string, Autonomy>();
  for (const [column, value] of parseMap(settings.automatorTriggers)) {
    triggers.set(column, value === "full_auto" ? "full_auto" : "supervised");
  }
  return {
    enabled: settings.automatorEnabled,
    // Strip a trailing slash so path joins are predictable.
    baseUrl: settings.automatorBaseUrl.replace(/\/+$/, ""),
    token: settings.automatorToken,
    repoPaths: parseMap(settings.automatorRepoPaths),
    triggers,
  };
}

// --- HTTP client -------------------------------------------------------------

class AutomatorError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "AutomatorError";
    this.code = code;
    this.status = status;
  }
}

// Map any thrown error to a client-safe message + HTTP status for the proxy
// routes (preserves the daemon's status for disabled/unreachable/4xx cases).
export function automatorErrorInfo(error: unknown): { message: string; status: number } {
  if (error instanceof AutomatorError) return { message: error.message, status: error.status };
  return { message: error instanceof Error ? error.message : "Automator request failed", status: 500 };
}

async function request(config: AutomatorConfig, path: string, init?: RequestInit): Promise<Response> {
  if (!config.enabled) throw new AutomatorError("AgentAutomator integration is disabled", "disabled", 503);
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  if (init?.body) headers["content-type"] = "content-type" in headers ? headers["content-type"] : "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, { ...init, headers });
  } catch (error) {
    throw new AutomatorError(
      `Could not reach the automator daemon at ${config.baseUrl}: ${error instanceof Error ? error.message : "network error"}`,
      "unreachable",
      502,
    );
  }

  if (!response.ok) {
    // Daemon error envelope: { error: { code, message } }.
    let code = "daemon_error";
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      /* non-JSON error body */
    }
    throw new AutomatorError(message, code, response.status);
  }

  return response;
}

async function requestJson<T>(config: AutomatorConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await request(config, path, init);
  return (await response.json()) as T;
}

export async function listRuns(config: AutomatorConfig, params: { state?: string; repo?: string } = {}): Promise<AutomatorRun[]> {
  const search = new URLSearchParams();
  if (params.state) search.set("state", params.state);
  if (params.repo) search.set("repo", params.repo);
  const qs = search.toString();
  return requestJson<AutomatorRun[]>(config, `/runs${qs ? `?${qs}` : ""}`);
}

export async function getRun(config: AutomatorConfig, id: string): Promise<{ run: AutomatorRun; artifacts: unknown }> {
  return requestJson(config, `/runs/${encodeURIComponent(id)}`);
}

export async function getRunSteps(config: AutomatorConfig, id: string): Promise<unknown[]> {
  return requestJson(config, `/runs/${encodeURIComponent(id)}/steps`);
}

export async function getArtifact(config: AutomatorConfig, id: string, name: string): Promise<string> {
  const response = await request(config, `/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`);
  return response.text();
}

const RUN_ACTIONS = new Set(["start", "pause", "resume", "stop", "kill", "approve", "open-pr"]);
export function isRunAction(action: string): boolean {
  return RUN_ACTIONS.has(action);
}

export async function runAction(config: AutomatorConfig, id: string, action: string): Promise<AutomatorRun> {
  if (!isRunAction(action)) throw new AutomatorError(`Unknown run action: ${action}`, "invalid_command", 400);
  return requestJson<AutomatorRun>(config, `/runs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export type CreateRunBody = {
  source: { type: "github_issue"; repo: string; issueNumber: number; body: string };
  autonomy: Autonomy;
  idempotencyKey: string;
  repoPath: string;
  start: boolean;
};

export async function createRun(config: AutomatorConfig, body: CreateRunBody): Promise<AutomatorRun> {
  return requestJson<AutomatorRun>(config, "/runs", { method: "POST", body: JSON.stringify(body) });
}

// --- Read-only repo chat -----------------------------------------------------

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ThinkingEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; label: string; status: string };

export async function chatWithRepo(
  config: AutomatorConfig,
  body: { repoPath: string; messages: ChatMessage[]; model?: string },
): Promise<{ reply: string; thinking?: ThinkingEvent[]; profile: string }> {
  return requestJson(config, "/chat", { method: "POST", body: JSON.stringify(body) });
}

// Returns the raw streaming Response (NDJSON body) so the caller can relay it.
export async function openChatStream(
  config: AutomatorConfig,
  body: { repoPath: string; messages: ChatMessage[]; model?: string },
): Promise<Response> {
  return request(config, "/chat/stream", { method: "POST", body: JSON.stringify(body) });
}

export type AutomatorModel = { id: string; free: boolean };

export async function listModels(config: AutomatorConfig): Promise<AutomatorModel[]> {
  const data = await requestJson<{ models: AutomatorModel[] }>(config, "/models");
  return data.models ?? [];
}

// --- Chat-history migration + AGENTS.md doctor (AgentAutomator#6) -------------
//
// The daemon mines local Claude Code + Codex transcripts for frustration moments
// (receipts) and synthesizes learned rules that feed the #4 pending queue. These
// endpoints are only meaningful when the daemon runs local to the transcript
// files; every one degrades to a clear offline state in the UI when unreachable.
//
// Privacy: receipts carry verbatim quotes from work chats. This layer only
// relays them to the browser — it never persists or logs message bodies.

export type ImportSource = "claude" | "codex" | (string & {});

export type ImportStats = {
  sessionsScanned?: number;
  candidatesFound?: number;
  lessonsSynthesized?: number;
  batchIndex?: number;
  batchTotal?: number;
};

export type ImportPhase = "idle" | "mining" | "reviewing" | "synthesizing" | "done" | "error" | (string & {});

export type ImportStatus = {
  active: boolean;
  phase: ImportPhase;
  stats: ImportStats;
  rateLimitedUntil?: string | null;
  message?: string | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type ImportCandidate = {
  id?: string;
  source: ImportSource;
  project: string;
  timestamp: string;
  score: number;
  signals: string[];
  userMessage: string;
  assistantBefore: string;
};

export type ImportLesson = {
  id?: string;
  candidateId?: string;
  rule: string;
  scope: "global" | "project" | (string & {});
  category: string;
  // Provenance echoed back so a receipt can be matched to its lesson client-side.
  source?: string;
  project?: string;
  timestamp?: string;
  userMessage?: string;
};

export type PendingRule = {
  id: string;
  text: string;
  scope: "global" | "project" | (string & {});
  category?: string | null;
  project?: string | null;
  source?: string | null; // "import" | "capture" | ...
  fromMessage?: string | null; // the original user message that earned the rule
  createdAt?: string | null;
};

export type RuleDecision = { status: "approved" | "rejected"; editedText?: string };

export type DoctorFinding = {
  severity: "high" | "medium" | "low" | (string & {});
  quote: string;
  problem: string;
  suggestedRewrite: string;
};

export type DoctorResult = {
  score: number;
  findings: DoctorFinding[];
};

// The daemon persists everything as snake_case SQLite rows and returns them
// mostly verbatim (import-store.ts). These adapters normalize the wire shape
// into the camelCase contract the UI consumes so the client stays clean.

// GET /import-chats → { run: <import_runs row> | null, active, activeRunId }.
type RawImportRun = {
  id: string;
  status: string;
  stats?: Record<string, unknown>;
  stopped_reason?: string | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
} | null;

type RawImportEnvelope = { run: RawImportRun; active?: boolean; activeRunId?: string | null };

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStatus(raw: RawImportEnvelope): ImportStatus {
  const run = raw?.run ?? null;
  const stats = (run?.stats ?? {}) as Record<string, unknown>;
  const claude = asNumber(stats.claudeSessions);
  const codex = asNumber(stats.codexSessions);
  const sessionsScanned = claude !== undefined || codex !== undefined ? (claude ?? 0) + (codex ?? 0) : undefined;
  return {
    active: Boolean(raw?.active),
    phase: (run?.status ?? "idle") as ImportPhase,
    stats: {
      sessionsScanned,
      candidatesFound: asNumber(stats.candidates),
      lessonsSynthesized: asNumber(stats.lessons) ?? asNumber(stats.synthesizedRules),
      batchIndex: asNumber(stats.completedBatches),
      batchTotal: asNumber(stats.totalBatches),
    },
    // The daemon surfaces rate-limit waits only on the /events stream; the polled
    // status carries stopped_reason once a run ends early.
    message: run?.stopped_reason ?? null,
    error: run?.error ?? null,
    startedAt: run?.started_at ?? null,
    finishedAt: run?.finished_at ?? null,
  };
}

export async function startImport(config: AutomatorConfig): Promise<ImportStatus> {
  const raw = await requestJson<RawImportEnvelope>(config, "/import-chats", { method: "POST", body: "{}" });
  return normalizeStatus(raw);
}

export async function getImportStatus(config: AutomatorConfig): Promise<ImportStatus> {
  const raw = await requestJson<RawImportEnvelope>(config, "/import-chats");
  return normalizeStatus(raw);
}

type RawCandidate = {
  id: number;
  source: string;
  project: string;
  timestamp: string | null;
  score: number;
  signals: string[];
  user_message: string;
  assistant_before: string | null;
};

export async function getImportCandidates(
  config: AutomatorConfig,
  params: { project?: string; signal?: string; source?: string } = {},
): Promise<ImportCandidate[]> {
  const search = new URLSearchParams();
  if (params.project) search.set("project", params.project);
  if (params.signal) search.set("signal", params.signal);
  if (params.source) search.set("source", params.source);
  const qs = search.toString();
  const rows = await requestJson<RawCandidate[]>(config, `/import-chats/candidates${qs ? `?${qs}` : ""}`);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    source: row.source,
    project: row.project,
    timestamp: row.timestamp ?? "",
    score: row.score,
    signals: Array.isArray(row.signals) ? row.signals : [],
    userMessage: row.user_message,
    assistantBefore: row.assistant_before ?? "",
  }));
}

type RawLesson = { id: number; candidate_id: number | null; lesson: string; scope: string; category: string };

export async function getImportLessons(config: AutomatorConfig): Promise<ImportLesson[]> {
  const rows = await requestJson<RawLesson[]>(config, "/import-chats/lessons");
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    candidateId: row.candidate_id != null ? String(row.candidate_id) : undefined,
    rule: row.lesson,
    scope: row.scope,
    category: row.category,
  }));
}

type RawPendingRule = {
  id: number;
  run_id: string | null;
  lesson_id: number | null;
  rule_text: string;
  scope: string;
  status: string;
  created_at: string | null;
  // Provenance joined from the lesson + candidate (null when unlinked).
  category: string | null;
  project: string | null;
  from_message: string | null;
};

export async function getPendingRules(config: AutomatorConfig): Promise<PendingRule[]> {
  const rows = await requestJson<RawPendingRule[]>(config, "/rules/pending");
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    text: row.rule_text,
    scope: row.scope,
    category: row.category ?? null,
    project: row.project ?? null,
    source: "import",
    fromMessage: row.from_message ?? null,
    createdAt: row.created_at ?? null,
  }));
}

export async function decideRule(config: AutomatorConfig, id: string, decision: RuleDecision): Promise<unknown> {
  return requestJson(config, `/rules/${encodeURIComponent(id)}/decide`, { method: "POST", body: JSON.stringify(decision) });
}

export async function runDoctor(config: AutomatorConfig, content: string): Promise<DoctorResult> {
  // Daemon returns { score, findings[{severity: high|medium|low, quote, problem,
  // suggestedRewrite}], profile }; the extra `profile` field is harmless.
  return requestJson<DoctorResult>(config, "/agentsmd/doctor", { method: "POST", body: JSON.stringify({ content }) });
}

// --- Trigger -----------------------------------------------------------------

type ItemRaw = {
  content?: {
    __typename?: string;
    number?: number;
    state?: string;
    repository?: { nameWithOwner?: string };
  } | null;
  fieldValues?: { __typename?: string; name?: string; field?: { name?: string } }[];
};

function statusOf(fieldValues: ItemRaw["fieldValues"]): string | null {
  for (const value of fieldValues ?? []) {
    if (value?.__typename === "ProjectV2ItemFieldSingleSelectValue" && value.field?.name === "Status" && value.name) {
      return value.name;
    }
  }
  return null;
}

export type TriggerResult = { triggered: number; skipped: number; errors: number };

// Best-effort: after a sync, POST a run for every open issue sitting in a
// configured trigger column whose repo has a local-path mapping. Idempotency on
// the daemon dedups, so re-running every poll is safe. Never throws — a daemon
// outage must not break board sync.
export async function triggerRunsForBoard(projectId?: string): Promise<TriggerResult> {
  const result: TriggerResult = { triggered: 0, skipped: 0, errors: 0 };
  const config = await getAutomatorConfig();
  if (!config.enabled || !config.token || config.triggers.size === 0 || config.repoPaths.size === 0) return result;

  const settings = await getSettings();
  if (!settings.githubToken) return result;

  const rows = await query<{ raw: ItemRaw }>(
    projectId
      ? "SELECT raw FROM project_items WHERE project_id = $1 AND content_type = 'Issue'"
      : "SELECT pi.raw FROM project_items pi JOIN github_projects p ON p.id = pi.project_id WHERE p.enabled AND pi.content_type = 'Issue'",
    projectId ? [projectId] : [],
  );

  // Resolve each candidate to (repo, number, autonomy, repoPath).
  const candidates: { repository: string; number: number; autonomy: Autonomy; repoPath: string }[] = [];
  for (const { raw } of rows.rows) {
    const content = raw?.content;
    const repository = content?.repository?.nameWithOwner;
    const number = content?.number;
    if (!repository || typeof number !== "number") continue;
    if (content?.state && content.state !== "OPEN") continue; // don't act on closed issues
    const column = statusOf(raw.fieldValues);
    if (!column) continue;
    const autonomy = config.triggers.get(column);
    if (!autonomy) continue;
    const repoPath = config.repoPaths.get(repository);
    if (!repoPath) {
      result.skipped += 1; // in a trigger column but no path mapping
      continue;
    }
    candidates.push({ repository, number, autonomy, repoPath });
  }

  if (!candidates.length) return result;

  let bodies: Record<string, string> = {};
  try {
    bodies = await fetchIssueBodies(
      candidates.map((c) => ({ repository: c.repository, number: c.number })),
      settings.githubToken,
    );
  } catch (error) {
    console.error("automator: failed to fetch issue bodies", error);
    result.errors += candidates.length;
    return result;
  }

  for (const candidate of candidates) {
    const key = `${candidate.repository}#${candidate.number}`;
    try {
      await createRun(config, {
        source: { type: "github_issue", repo: candidate.repository, issueNumber: candidate.number, body: bodies[key] ?? "" },
        autonomy: candidate.autonomy,
        idempotencyKey: key,
        repoPath: candidate.repoPath,
        start: true,
      });
      result.triggered += 1;
    } catch (error) {
      console.error(`automator: failed to create run for ${key}`, error);
      result.errors += 1;
    }
  }

  return result;
}
