import { after } from "next/server";
import { query } from "@/db/client";
import { badRequest, ok, serverError } from "@/lib/json";
import { verifyGitHubSignature } from "@/server/health";
import { getSettings } from "@/server/settings";
import { webhookSync } from "@/server/sync";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const settings = await getSettings();
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyGitHubSignature(settings.webhookSecret, body, signature)) {
      return badRequest("Invalid webhook signature");
    }

    const event = request.headers.get("x-github-event") ?? "unknown";
    const payload = JSON.parse(body);
    await recordWebhookChange(event, payload);
    // Respond to GitHub immediately; pull fresh project state after the response.
    after(() => webhookSync().catch((error) => console.error("Webhook sync failed", error)));
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}

async function recordWebhookChange(event: string, payload: Record<string, unknown>) {
  const action = typeof payload.action === "string" ? payload.action : "received";
  const repository = payload.repository as { full_name?: string } | undefined;
  const sender = payload.sender as { login?: string } | undefined;
  const issue = payload.issue as { node_id?: string; title?: string; html_url?: string } | undefined;
  const pullRequest = payload.pull_request as { node_id?: string; title?: string; html_url?: string } | undefined;
  const comment = payload.comment as { node_id?: string; html_url?: string; body?: string } | undefined;
  const item = payload.projects_v2_item as { node_id?: string; content_node_id?: string } | undefined;
  const content = issue ?? pullRequest;

  await query(
    `INSERT INTO changes (repository, content_id, change_type, actor_login, title, url, summary, after_value, raw, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, 'webhook', now())`,
    [
      repository?.full_name ?? null,
      content?.node_id ?? comment?.node_id ?? item?.content_node_id ?? item?.node_id ?? null,
      `${event}_${action}`,
      sender?.login ?? null,
      content?.title ?? `${event} ${action}`,
      content?.html_url ?? comment?.html_url ?? null,
      `Webhook received: ${event}.${action}`,
      JSON.stringify(payload),
      JSON.stringify(payload),
    ],
  );
}
