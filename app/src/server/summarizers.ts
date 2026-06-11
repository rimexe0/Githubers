import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "@/db/client";
import type { AppSettings } from "@/lib/schemas";
import { getSettings } from "@/server/settings";

const execFileAsync = promisify(execFile);

type SummaryInput = {
  style: string;
  changes: unknown[];
};

type ProviderResult = {
  provider: string;
  body: string;
};

function buildPrompt(input: SummaryInput) {
  return [
    "Summarize these GitHub Project changes.",
    `Style: ${input.style}`,
    "Return a practical summary with changed work, blockers/risks, and action items where relevant.",
    "Changes JSON:",
    JSON.stringify(input.changes, null, 2),
  ].join("\n\n");
}

async function summarizeWithLmStudio(input: SummaryInput, settings: AppSettings): Promise<ProviderResult> {
  const response = await fetch(`${settings.lmStudioBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.lmStudioModel,
      temperature: settings.lmStudioTemperature,
      max_tokens: settings.lmStudioMaxTokens,
      messages: [
        { role: "system", content: "You summarize GitHub project activity for a software team." },
        { role: "user", content: buildPrompt(input) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`LM Studio failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const body = payload.choices?.[0]?.message?.content;
  if (!body) throw new Error("LM Studio returned no summary content");
  return { provider: "lmstudio", body };
}

async function summarizeWithCommand(provider: "codex" | "opencode", command: string, input: SummaryInput): Promise<ProviderResult> {
  const [bin, ...baseArgs] = command.split(" ").filter(Boolean);
  if (!bin) throw new Error(`${provider} command is empty`);

  const prompt = buildPrompt(input);
  const args = provider === "codex" ? [...baseArgs, prompt] : [...baseArgs, prompt];
  const { stdout } = await execFileAsync(bin, args, { timeout: 1000 * 60 * 10, maxBuffer: 1024 * 1024 * 5 });
  const body = stdout.trim();
  if (!body) throw new Error(`${provider} returned no stdout`);
  return { provider, body };
}

async function summarizeNone(input: SummaryInput): Promise<ProviderResult> {
  return {
    provider: "none",
    body: `Raw change digest (${input.changes.length} changes):\n\n${JSON.stringify(input.changes, null, 2)}`,
  };
}

async function summarizeWithFallbacks(input: SummaryInput, settings: AppSettings): Promise<ProviderResult> {
  const providers = settings.summaryProviderOrder.split(",").flatMap((provider) => {
    const trimmed = provider.trim();
    return trimmed ? [trimmed] : [];
  });
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === "lmstudio") return await summarizeWithLmStudio(input, settings);
      if (provider === "codex") return await summarizeWithCommand("codex", settings.codexCommand, input);
      if (provider === "opencode") return await summarizeWithCommand("opencode", settings.opencodeCommand, input);
      if (provider === "none") return await summarizeNone(input);
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  throw new Error(`All summary providers failed: ${errors.join("; ")}`);
}

export async function runSummary(trigger: "scheduled" | "manual" = "manual") {
  const run = await query<{ id: string }>("INSERT INTO summary_runs (trigger, status) VALUES ($1, 'running') RETURNING id", [trigger]);
  const runId = run.rows[0].id;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

  try {
    const settings = await getSettings();
    const changes = await query(
      `SELECT c.change_type, c.actor_login, c.title, c.url, c.repository, c.summary, c.occurred_at,
              p.owner_login, p.project_number, p.title AS project_title
       FROM changes c
       LEFT JOIN github_projects p ON p.id = c.project_id
       WHERE c.occurred_at >= $1 AND c.occurred_at <= $2
       ORDER BY c.occurred_at ASC`,
      [periodStart, periodEnd],
    );

    const result = await summarizeWithFallbacks({ style: settings.summaryStyle, changes: changes.rows }, settings);
    const shortBody = result.body.split("\n").filter(Boolean).slice(0, 8).join("\n");

    const summary = await query<{ id: string }>(
      `INSERT INTO summaries (summary_run_id, provider, style, title, body, short_body, change_count, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [runId, result.provider, settings.summaryStyle, "Daily GitHub project summary", result.body, shortBody, changes.rowCount ?? 0, periodStart, periodEnd],
    );

    await query("UPDATE changes SET summarized_at = now() WHERE occurred_at >= $1 AND occurred_at <= $2", [periodStart, periodEnd]);
    await query("UPDATE summary_runs SET status = 'success', provider = $2, finished_at = now() WHERE id = $1", [runId, result.provider]);

    return { id: summary.rows[0].id, provider: result.provider, changeCount: changes.rowCount ?? 0 };
  } catch (error) {
    await query("UPDATE summary_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1", [
      runId,
      error instanceof Error ? error.message : "Unknown summary error",
    ]);
    throw error;
  }
}

export async function listSummaries() {
  const result = await query(
    "SELECT id, provider, title, short_body, body, change_count, period_start, period_end, created_at FROM summaries ORDER BY created_at DESC LIMIT 25",
  );
  return result.rows;
}
