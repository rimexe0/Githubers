import { createHash } from "node:crypto";
import { query } from "@/db/client";
import { triggerRunsForBoard } from "@/server/automator";
import type { LinkedRef } from "@/server/events";
import { diffFields, diffIssuePr, reviewVerb, snapshotKind } from "@/server/events";
import type { CommentNode, ProjectV2ItemNode, ReviewNode } from "@/server/github";
import { fetchProjectState, fetchProjectUpdatedAts } from "@/server/github";
import { listProjects } from "@/server/projects";
import { getSettings } from "@/server/settings";

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type SyncProject = Awaited<ReturnType<typeof listProjects>>[number];

function contentWithoutComments(content: ProjectV2ItemNode["content"]) {
  if (!content) return null;
  const { comments: _comments, ...rest } = content;
  return rest;
}

// The hashed issue/PR snapshot: drop the high-churn collections AND the
// volatile updatedAt, so the diff only fires on meaningful metadata moves
// (state/title/assignees/labels) — not every time GitHub bumps the timestamp.
// Reviews and linked refs are tracked through their own paths.
function issuePrSnapshot(content: NonNullable<ProjectV2ItemNode["content"]>) {
  const { comments: _comments, reviews: _reviews, closingIssuesReferences: _refs, updatedAt: _updatedAt, ...rest } = content;
  return rest;
}

function githubTime(iso: string | undefined | null): Date {
  return iso ? new Date(iso) : new Date();
}

function closingRefs(content: NonNullable<ProjectV2ItemNode["content"]>): LinkedRef[] {
  return (content.closingIssuesReferences?.nodes ?? []).map((node) => ({
    relation: "closes" as const,
    repository: node.repository?.nameWithOwner ?? null,
    number: node.number,
    url: node.url ?? null,
    title: node.title ?? null,
  }));
}

async function recordIssuePrSnapshot(project: SyncProject, item: ProjectV2ItemNode) {
  const content = item.content;
  if (!content?.id || !["Issue", "PullRequest"].includes(content.__typename)) return 0;

  const snapshot = issuePrSnapshot(content);
  const snapshotHash = hashJson(snapshot);
  const previous = await query<{ snapshot_hash: string; snapshot: unknown }>(
    `SELECT snapshot_hash, snapshot FROM issue_pr_snapshots
     WHERE project_id = $1 AND content_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [project.id, content.id],
  );

  if (previous.rowCount !== 0 && previous.rows[0].snapshot_hash === snapshotHash) return 0;

  await query("INSERT INTO issue_pr_snapshots (project_id, content_id, snapshot, snapshot_hash) VALUES ($1, $2, $3::jsonb, $4)", [
    project.id,
    content.id,
    JSON.stringify(snapshot),
    snapshotHash,
  ]);

  // First time we snapshot this issue/PR: project_item_added already announced
  // it, so just establish a baseline without a noisy change row.
  if (previous.rowCount === 0) return 0;

  const kind = snapshotKind(snapshot);
  const linkedRefs = closingRefs(content);
  const occurredAt = githubTime(content.updatedAt);
  const diffs = diffIssuePr(previous.rows[0].snapshot as Parameters<typeof diffIssuePr>[0], snapshot);

  for (const diff of diffs) {
    await query(
      `INSERT INTO changes
         (project_id, repository, content_id, change_type, event_kind, event_verb, subject_number, linked_refs, actor_login, title, url, summary, before_value, after_value, raw, source, occurred_at)
       VALUES ($1, $2, $3, 'issue_pr_changed', $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, 'poll', $15)`,
      [
        project.id,
        content.repository?.nameWithOwner ?? null,
        content.id,
        kind,
        diff.eventVerb,
        content.number ?? null,
        JSON.stringify(linkedRefs),
        content.author?.login ?? null,
        content.title ?? `${content.__typename} ${content.id}`,
        content.url ?? null,
        `${content.__typename} ${diff.eventVerb.replace(/_/g, " ")}.`,
        JSON.stringify(diff.before),
        JSON.stringify(diff.after),
        JSON.stringify({ content: snapshot }),
        occurredAt,
      ],
    );
  }

  return diffs.length;
}

async function recordReviews(project: SyncProject, item: ProjectV2ItemNode) {
  const content = item.content;
  if (!content?.id || content.__typename !== "PullRequest" || !content.reviews?.nodes.length) return 0;
  const results = await Promise.all(content.reviews.nodes.map((review) => recordReview(project, item, review)));
  return results.reduce((total, count) => total + count, 0);
}

async function recordReview(project: SyncProject, item: ProjectV2ItemNode, review: ReviewNode): Promise<number> {
  const content = item.content;
  if (!content?.id) return 0;

  const previous = await query<{ state: string | null }>(
    "SELECT state FROM pr_reviews WHERE project_id = $1 AND github_review_id = $2",
    [project.id, review.id],
  );
  const submittedAt = review.submittedAt ? new Date(review.submittedAt) : new Date();

  await query(
    `INSERT INTO pr_reviews (project_id, content_id, github_review_id, author_login, state, body, url, submitted_at, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (project_id, github_review_id) DO UPDATE SET
       state = EXCLUDED.state, body = EXCLUDED.body, url = EXCLUDED.url, submitted_at = EXCLUDED.submitted_at, raw = EXCLUDED.raw`,
    [project.id, content.id, review.id, review.author?.login ?? null, review.state, review.body, review.url, submittedAt, JSON.stringify(review)],
  );

  const isNew = previous.rowCount === 0;
  if (!isNew && previous.rows[0].state === review.state) return 0;

  await query(
    `INSERT INTO changes
       (project_id, repository, content_id, change_type, event_kind, event_verb, subject_number, linked_refs, actor_login, title, url, summary, after_value, raw, source, occurred_at)
     VALUES ($1, $2, $3, 'review', 'review', $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'poll', $13)`,
    [
      project.id,
      content.repository?.nameWithOwner ?? null,
      content.id,
      reviewVerb(review.state),
      content.number ?? null,
      JSON.stringify(closingRefs(content)),
      review.author?.login ?? null,
      content.title ?? `PullRequest ${content.id}`,
      review.url,
      review.body?.trim() ? review.body : `Review ${review.state.toLowerCase()}.`,
      JSON.stringify({ state: review.state }),
      JSON.stringify(review),
      submittedAt,
    ],
  );

  return 1;
}

async function recordComments(project: SyncProject, item: ProjectV2ItemNode) {
  const content = item.content;
  if (!content?.id || !content.comments?.nodes.length) return 0;

  const results = await Promise.all(content.comments.nodes.map((comment) => recordComment(project, item, comment)));
  return results.reduce((total, count) => total + count, 0);
}

async function recordComment(project: SyncProject, item: ProjectV2ItemNode, comment: CommentNode): Promise<number> {
  const content = item.content;
  if (!content?.id) return 0;

  const previous = await query<{ body: string | null; github_updated_at: Date | null; raw: unknown }>(
    "SELECT body, github_updated_at, raw FROM comments WHERE project_id = $1 AND github_comment_id = $2",
    [project.id, comment.id],
  );
  const commentUpdatedAt = comment.updatedAt ? new Date(comment.updatedAt) : null;

  await query(
    `INSERT INTO comments (project_id, content_id, github_comment_id, author_login, body, url, github_updated_at, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
     ON CONFLICT (project_id, github_comment_id) DO UPDATE SET
       content_id = EXCLUDED.content_id,
       author_login = EXCLUDED.author_login,
       body = EXCLUDED.body,
       url = EXCLUDED.url,
       github_updated_at = EXCLUDED.github_updated_at,
       raw = EXCLUDED.raw,
       updated_at = now()`,
    [project.id, content.id, comment.id, comment.author?.login ?? null, comment.body, comment.url, commentUpdatedAt, JSON.stringify(comment)],
  );

  const isChanged =
    previous.rowCount === 0 ||
    previous.rows[0].body !== comment.body ||
    previous.rows[0].github_updated_at?.toISOString() !== commentUpdatedAt?.toISOString();
  if (!isChanged) return 0;

  const isNew = previous.rowCount === 0;
  const changeType = isNew ? "comment_added" : "comment_changed";
  await query(
    `INSERT INTO changes
       (project_id, repository, content_id, change_type, event_kind, event_verb, subject_number, actor_login, title, url, summary, before_value, after_value, raw, source, occurred_at)
     VALUES ($1, $2, $3, $4, 'comment', $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, 'poll', $14)`,
    [
      project.id,
      content.repository?.nameWithOwner ?? null,
      content.id,
      changeType,
      isNew ? "commented" : "comment_edited",
      content.number ?? null,
      comment.author?.login ?? null,
      content.title ?? `${content.__typename} comment`,
      comment.url,
      comment.body?.trim() ? comment.body : isNew ? "(empty comment)" : "(comment edited)",
      isNew ? null : JSON.stringify(previous.rows[0].raw),
      JSON.stringify(comment),
      JSON.stringify({ comment, content: contentWithoutComments(content) }),
      commentUpdatedAt ?? new Date(),
    ],
  );

  return 1;
}

async function processProjectItem(project: SyncProject, item: ProjectV2ItemNode) {
  let changesFound = 0;
  const content = item.content ?? null;
  // Board-level snapshot: only the project fields (status column, custom
  // fields). Content metadata changes (state/title/assignees/labels) are owned
  // by recordIssuePrSnapshot, so they don't double-emit here.
  const snapshot = {
    githubItemId: item.id,
    type: item.type,
    fieldValues: item.fieldValues.nodes,
  };
  const snapshotHash = hashJson(snapshot);
  // The board renders from project_items.raw, so it needs the content; the
  // hash above stays content-free so board-field moves are what trigger here.
  const boardRaw = { ...snapshot, content: contentWithoutComments(content) };

  const previous = await query<{ snapshot_hash: string; snapshot: unknown }>(
    `SELECT snapshot_hash, snapshot FROM item_snapshots
     WHERE project_id = $1 AND github_item_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [project.id, item.id],
  );

  await query(
    `INSERT INTO project_items (project_id, github_item_id, content_type, content_id, content_url, title, state, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
     ON CONFLICT (project_id, github_item_id) DO UPDATE SET
       content_type = EXCLUDED.content_type,
       content_id = EXCLUDED.content_id,
       content_url = EXCLUDED.content_url,
       title = EXCLUDED.title,
       state = EXCLUDED.state,
       raw = EXCLUDED.raw,
       updated_at = now()`,
    [project.id, item.id, content?.__typename ?? item.type, content?.id ?? null, content?.url ?? null, content?.title ?? null, content?.state ?? null, JSON.stringify(boardRaw)],
  );

  if (previous.rowCount === 0 || previous.rows[0].snapshot_hash !== snapshotHash) {
    await query(
      "INSERT INTO item_snapshots (project_id, github_item_id, snapshot, snapshot_hash) VALUES ($1, $2, $3::jsonb, $4)",
      [project.id, item.id, JSON.stringify(snapshot), snapshotHash],
    );

    const isNew = previous.rowCount === 0;
    const previousSnapshot = isNew ? null : (previous.rows[0].snapshot as { fieldValues?: unknown });
    const fieldsDiff = isNew ? "" : diffFields(previousSnapshot?.fieldValues, item.fieldValues.nodes);

    // Only record a board event when the item is newly added or a field
    // actually moved — not when the snapshot churned for some other reason.
    if (isNew || fieldsDiff) {
      await query(
        `INSERT INTO changes
           (project_id, repository, content_id, change_type, event_kind, event_verb, subject_number, actor_login, title, url, summary, before_value, after_value, raw, source, occurred_at)
         VALUES ($1, $2, $3, $4, 'project', $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, 'poll', $14)`,
        [
          project.id,
          content?.repository?.nameWithOwner ?? null,
          content?.id ?? item.id,
          isNew ? "project_item_added" : "project_item_changed",
          isNew ? "item_added" : "fields_changed",
          content?.number ?? null,
          content?.author?.login ?? null,
          content?.title ?? `Project item ${item.id}`,
          content?.url ?? null,
          isNew ? "Added to project." : fieldsDiff,
          isNew ? null : JSON.stringify(previous.rows[0].snapshot),
          JSON.stringify(snapshot),
          JSON.stringify({ item }),
          githubTime(content?.updatedAt),
        ],
      );
      changesFound += 1;
    }
  }

  const [issuePrChanges, commentChanges, reviewChanges] = await Promise.all([
    recordIssuePrSnapshot(project, item),
    recordComments(project, item),
    recordReviews(project, item),
  ]);
  return changesFound + issuePrChanges + commentChanges + reviewChanges;
}

async function processProject(project: SyncProject, githubToken: string, commentPollLimit: number) {
  const state = await fetchProjectState(project, githubToken, commentPollLimit);
  const itemResults = await Promise.all(state.items.map((item) => processProjectItem(project, item)));
  await query("UPDATE github_projects SET title = $2, updated_at = now() WHERE id = $1", [project.id, state.title]);
  return itemResults.reduce((total, count) => total + count, 0);
}

export async function runSync(trigger: "scheduled" | "manual" | "webhook" | "auto" = "manual", projectId?: string) {
  const run = await query<{ id: string }>("INSERT INTO sync_runs (trigger, status) VALUES ($1, 'running') RETURNING id", [trigger]);
  const runId = run.rows[0].id;
  let projectsChecked = 0;
  let changesFound = 0;

  try {
    const settings = await getSettings();
    const projects = (await listProjects()).filter((project) => project.enabled && (!projectId || project.id === projectId));

    projectsChecked = projects.length;
    const projectResults = await Promise.all(projects.map((project) => processProject(project, settings.githubToken, settings.commentPollLimit)));
    changesFound = projectResults.reduce((total, count) => total + count, 0);

    await query(
      "UPDATE sync_runs SET status = 'success', finished_at = now(), projects_checked = $2, changes_found = $3 WHERE id = $1",
      [runId, projectsChecked, changesFound],
    );

    // Best-effort: kick off agent runs for issues that landed in a trigger
    // column. The daemon dedups by idempotency key, so re-firing each poll is
    // safe, and a daemon outage must not fail the sync.
    try {
      const triggered = await triggerRunsForBoard(projectId);
      if (triggered.triggered || triggered.errors) {
        console.log(`automator: triggered ${triggered.triggered} run(s), ${triggered.skipped} skipped, ${triggered.errors} error(s)`);
      }
    } catch (error) {
      console.error("automator: trigger pass failed", error);
    }
  } catch (error) {
    await query("UPDATE sync_runs SET status = 'failed', finished_at = now(), projects_checked = $2, changes_found = $3, error = $4 WHERE id = $1", [
      runId,
      projectsChecked,
      changesFound,
      error instanceof Error ? error.message : "Unknown sync error",
    ]);
    throw error;
  }

  return { id: runId, projectsChecked, changesFound };
}

const AUTO_SYNC_MIN_AGE_MINUTES = 1;
const AUTO_SYNC_MAX_AGE_MINUTES = 10;

// Page-load sync that stays cheap: full sync only when stale or when the
// one-point-per-project updatedAt probe says a board actually changed.
export async function autoSync() {
  const running = await query("SELECT id FROM sync_runs WHERE status = 'running' AND started_at > now() - interval '5 minutes' LIMIT 1");
  if (running.rowCount !== 0) return { synced: false, reason: "Sync already running" };

  const last = await query<{ started_at: Date }>("SELECT started_at FROM sync_runs WHERE status = 'success' ORDER BY started_at DESC LIMIT 1");
  const lastSyncAt = last.rows[0]?.started_at ?? null;
  const ageMinutes = lastSyncAt ? (Date.now() - lastSyncAt.getTime()) / 60_000 : Infinity;

  if (ageMinutes < AUTO_SYNC_MIN_AGE_MINUTES) return { synced: false, reason: "Synced moments ago" };

  if (ageMinutes > AUTO_SYNC_MAX_AGE_MINUTES) {
    const run = await runSync("auto");
    return { synced: true, reason: "Last sync was stale", changesFound: run.changesFound };
  }

  const settings = await getSettings();
  const projects = (await listProjects()).filter((project) => project.enabled);
  const updatedAts = await fetchProjectUpdatedAts(projects, settings.githubToken);
  const changed = projects.some((project) => {
    const updatedAt = updatedAts[project.id];
    return updatedAt && lastSyncAt && new Date(updatedAt) > lastSyncAt;
  });
  if (!changed) return { synced: false, reason: "Up to date" };

  const run = await runSync("auto");
  return { synced: true, reason: "Board changed upstream", changesFound: run.changesFound };
}

// Webhook-driven sync with a DB-based cooldown so event bursts coalesce.
export async function webhookSync() {
  const recent = await query("SELECT id FROM sync_runs WHERE started_at > now() - interval '2 minutes' LIMIT 1");
  if (recent.rowCount !== 0) return;
  await runSync("webhook");
}

export async function listSyncRuns() {
  const result = await query(
    "SELECT id, trigger, status, started_at, finished_at, projects_checked, changes_found, error FROM sync_runs ORDER BY started_at DESC LIMIT 25",
  );
  return result.rows;
}

export async function listChanges() {
  const result = await query(
    `SELECT c.id, c.change_type, c.actor_login, c.title, c.url, c.summary, c.repository, c.occurred_at,
            p.owner_login, p.project_number, p.title AS project_title
     FROM changes c
     LEFT JOIN github_projects p ON p.id = c.project_id
     ORDER BY c.occurred_at DESC
     LIMIT 100`,
  );
  return result.rows;
}
