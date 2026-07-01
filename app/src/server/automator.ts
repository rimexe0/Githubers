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
