import { after } from "next/server";
import { query } from "@/db/client";
import { badRequest, ok, serverError } from "@/lib/json";
import { normalizeWebhook } from "@/server/events";
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

type Obj = Record<string, unknown> | undefined;

function obj(value: unknown): Obj {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

// Picks the subject (issue or PR) the event is about, so review/comment events
// thread under the same content_id as the PR/issue itself.
function pickSubject(payload: Record<string, unknown>) {
  const issue = obj(payload.issue);
  const pullRequest = obj(payload.pull_request);
  const subject = pullRequest ?? issue;
  const comment = obj(payload.comment);
  const review = obj(payload.review);
  const item = obj(payload.projects_v2_item);
  return {
    contentId:
      str(subject?.node_id) ?? str(item?.content_node_id) ?? str(item?.node_id) ?? str(comment?.node_id) ?? str(review?.node_id),
    title: str(subject?.title),
    number: num(subject?.number),
    // Reviews/comments link to their own anchor; otherwise the subject's page.
    url: str(review?.html_url) ?? str(comment?.html_url) ?? str(subject?.html_url),
  };
}

async function recordWebhookChange(event: string, payload: Record<string, unknown>) {
  const action = typeof payload.action === "string" ? payload.action : "received";
  const repository = str(obj(payload.repository)?.full_name);
  const sender = str(obj(payload.sender)?.login);
  const { eventKind, eventVerb, linkedRefs } = normalizeWebhook(event, action, payload);
  const subject = pickSubject(payload);

  await query(
    `INSERT INTO changes
       (repository, content_id, change_type, event_kind, event_verb, subject_number, linked_refs, actor_login, title, url, summary, after_value, raw, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13::jsonb, 'webhook', now())`,
    [
      repository,
      subject.contentId,
      `${event}_${action}`,
      eventKind,
      eventVerb,
      subject.number,
      JSON.stringify(linkedRefs),
      sender,
      subject.title ?? `${event} ${action}`,
      subject.url,
      `${event}.${action}`,
      JSON.stringify(payload),
      JSON.stringify(payload),
    ],
  );
}
