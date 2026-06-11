import { createHash } from "node:crypto";
import { query } from "@/db/client";
import { fetchProjectState } from "@/server/github";
import { listProjects } from "@/server/projects";
import { getSettings } from "@/server/settings";

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function runSync(trigger: "scheduled" | "manual" | "webhook" = "manual") {
  const run = await query<{ id: string }>("INSERT INTO sync_runs (trigger, status) VALUES ($1, 'running') RETURNING id", [trigger]);
  const runId = run.rows[0].id;
  let projectsChecked = 0;
  let changesFound = 0;

  try {
    const settings = await getSettings();
    const projects = (await listProjects()).filter((project) => project.enabled);

    for (const project of projects) {
      projectsChecked += 1;
      const state = await fetchProjectState(project, settings.githubToken);

      await query("UPDATE github_projects SET title = $2, updated_at = now() WHERE id = $1", [project.id, state.title]);

      for (const item of state.items) {
        const content = item.content ?? null;
        const snapshot = {
          githubItemId: item.id,
          type: item.type,
          content,
          fieldValues: item.fieldValues.nodes,
        };
        const snapshotHash = hashJson(snapshot);

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
          [project.id, item.id, content?.__typename ?? item.type, content?.id ?? null, content?.url ?? null, content?.title ?? null, content?.state ?? null, JSON.stringify(snapshot)],
        );

        if (previous.rowCount === 0 || previous.rows[0].snapshot_hash !== snapshotHash) {
          await query(
            "INSERT INTO item_snapshots (project_id, github_item_id, snapshot, snapshot_hash) VALUES ($1, $2, $3::jsonb, $4)",
            [project.id, item.id, JSON.stringify(snapshot), snapshotHash],
          );

          const changeType = previous.rowCount === 0 ? "project_item_added" : "project_item_changed";
          await query(
            `INSERT INTO changes (project_id, repository, content_id, change_type, actor_login, title, url, summary, before_value, after_value, raw, source, occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, 'poll', now())`,
            [
              project.id,
              content?.repository?.nameWithOwner ?? null,
              content?.id ?? item.id,
              changeType,
              content?.author?.login ?? null,
              content?.title ?? `Project item ${item.id}`,
              content?.url ?? null,
              previous.rowCount === 0 ? "Project item discovered during sync." : "Project item snapshot changed during sync.",
              previous.rowCount === 0 ? null : JSON.stringify(previous.rows[0].snapshot),
              JSON.stringify(snapshot),
              JSON.stringify({ item }),
            ],
          );
          changesFound += 1;
        }
      }
    }

    await query(
      "UPDATE sync_runs SET status = 'success', finished_at = now(), projects_checked = $2, changes_found = $3 WHERE id = $1",
      [runId, projectsChecked, changesFound],
    );
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
