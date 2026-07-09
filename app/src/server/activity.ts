// Groups the flat `changes` feed into per-subject threads (one issue/PR/item =
// one thread) and layers the inbox read/done state on top. This is what the
// Activity page renders.
import { query } from "@/db/client";
import type { EventKind, LinkedRef } from "@/server/events";

export type ActivityEvent = {
  id: string;
  changeType: string;
  kind: EventKind | null;
  verb: string | null;
  actor: string | null;
  title: string | null;
  url: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  linkedRefs: LinkedRef[];
  source: string;
  occurredAt: string;
  unread: boolean;
};

export type ActivityThread = {
  key: string;
  contentId: string | null;
  subjectType: EventKind | "other";
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  project: { ownerLogin: string | null; projectNumber: number | null; title: string | null } | null;
  events: ActivityEvent[];
  linkedRefs: LinkedRef[];
  linkedPrs: LinkedPr[];
  lastEventAt: string;
  unreadCount: number;
  done: boolean;
};

export type LinkedPr = {
  number: number;
  repository: string | null;
  url: string | null;
  state: string | null;
};

export type ActivityFacets = {
  repositories: string[];
  actors: string[];
  kinds: string[];
};

export type ActivityFilters = {
  repository?: string;
  kind?: string;
  actor?: string;
  projectId?: string;
  search?: string;
  unreadOnly?: boolean;
  includeDone?: boolean;
};

type ChangeRow = {
  id: string;
  change_type: string;
  event_kind: EventKind | null;
  event_verb: string | null;
  actor_login: string | null;
  title: string | null;
  url: string | null;
  summary: string | null;
  repository: string | null;
  subject_number: number | null;
  content_id: string | null;
  linked_refs: LinkedRef[] | null;
  before_value: unknown;
  after_value: unknown;
  source: string;
  occurred_at: string;
  owner_login: string | null;
  project_number: number | null;
  project_title: string | null;
  last_read_at: string | null;
  done: boolean | null;
};

const STATE_VERBS: Record<string, string> = {
  opened: "OPEN",
  reopened: "OPEN",
  item_added: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};

function afterState(after: unknown): string | null {
  if (after && typeof after === "object" && "state" in after) {
    const value = (after as { state?: unknown }).state;
    return typeof value === "string" ? value.toUpperCase() : null;
  }
  return null;
}

function subjectTypeFor(events: ActivityEvent[]): ActivityThread["subjectType"] {
  for (const event of events) {
    if (event.kind === "pr" || event.kind === "issue") return event.kind;
    if (event.kind === "review") return "pr";
  }
  return events[0]?.kind ?? "other";
}

function dedupeRefs(refs: LinkedRef[]): LinkedRef[] {
  const map = new Map<string, LinkedRef>();
  for (const ref of refs) {
    const key = `${ref.repository ?? ""}#${ref.number}`;
    const existing = map.get(key);
    if (!existing || (ref.relation === "closes" && existing.relation !== "closes")) map.set(key, ref);
  }
  return [...map.values()];
}

export async function listActivityThreads(filters: ActivityFilters = {}): Promise<{ threads: ActivityThread[]; facets: ActivityFacets }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    conditions.push(clause.replace("$?", `$${params.length}`));
  };

  if (filters.repository) add("c.repository = $?", filters.repository);
  if (filters.kind) add("c.event_kind = $?", filters.kind);
  if (filters.actor) add("c.actor_login = $?", filters.actor);
  if (filters.projectId) add("c.project_id = $?", filters.projectId);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const idx = params.length;
    conditions.push(`(c.title ILIKE $${idx} OR c.repository ILIKE $${idx})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query<ChangeRow>(
    `SELECT c.id, c.change_type, c.event_kind, c.event_verb, c.actor_login, c.title, c.url, c.summary,
            c.repository, c.subject_number, c.content_id, c.linked_refs, c.before_value, c.after_value,
            c.source, c.occurred_at,
            p.owner_login, p.project_number, p.title AS project_title,
            tr.last_read_at, tr.done
     FROM changes c
     LEFT JOIN github_projects p ON p.id = c.project_id
     LEFT JOIN thread_reads tr ON tr.content_id = c.content_id
     ${where}
     ORDER BY c.occurred_at DESC
     LIMIT 1000`,
    params,
  );

  const threadMap = new Map<string, ActivityThread>();
  const order: string[] = [];

  for (const row of result.rows) {
    const key = row.content_id ?? `event:${row.id}`;
    const lastReadAt = row.last_read_at ? new Date(row.last_read_at).getTime() : 0;
    const event: ActivityEvent = {
      id: row.id,
      changeType: row.change_type,
      kind: row.event_kind,
      verb: row.event_verb,
      actor: row.actor_login,
      title: row.title,
      url: row.url,
      summary: row.summary,
      before: row.before_value,
      after: row.after_value,
      linkedRefs: row.linked_refs ?? [],
      source: row.source,
      occurredAt: new Date(row.occurred_at).toISOString(),
      unread: new Date(row.occurred_at).getTime() > lastReadAt,
    };

    let thread = threadMap.get(key);
    if (!thread) {
      thread = {
        key,
        contentId: row.content_id,
        subjectType: "other",
        repository: row.repository,
        number: row.subject_number,
        title: row.title,
        url: row.url,
        state: null,
        project: row.owner_login || row.project_number ? { ownerLogin: row.owner_login, projectNumber: row.project_number, title: row.project_title } : null,
        events: [],
        linkedRefs: [],
        linkedPrs: [],
        lastEventAt: event.occurredAt,
        unreadCount: 0,
        done: Boolean(row.done),
      };
      threadMap.set(key, thread);
      order.push(key);
    }

    thread.events.push(event);
    // Rows arrive newest-first; keep the first non-empty subject fields seen.
    if (!thread.repository && row.repository) thread.repository = row.repository;
    if (thread.number == null && row.subject_number != null) thread.number = row.subject_number;
    if ((!thread.title || !thread.url) && row.url) {
      thread.title = thread.title ?? row.title;
      thread.url = row.url;
    }
  }

  // Finalize every thread first (state, counts, refs) so cross-linking can see
  // the whole set before any filtering trims it.
  const allThreads = order.map((key) => {
    const thread = threadMap.get(key)!;
    thread.subjectType = subjectTypeFor(thread.events);
    thread.unreadCount = thread.events.filter((event) => event.unread).length;
    thread.linkedRefs = dedupeRefs(thread.events.flatMap((event) => event.linkedRefs));

    // Subject state: newest event that asserts one, by verb or after_value.
    for (const event of thread.events) {
      const verbState = event.verb ? STATE_VERBS[event.verb] : undefined;
      const state = verbState ?? afterState(event.after);
      if (state) {
        thread.state = state;
        break;
      }
    }
    return thread;
  });

  // Cross-link: a PR that closes an issue (its linkedRefs) lends the issue a
  // back-reference, so the issue thread shows the PR and can tell it was closed
  // by a merge.
  const byRef = new Map<string, ActivityThread>();
  for (const thread of allThreads) {
    if (thread.repository && thread.number != null) byRef.set(`${thread.repository}#${thread.number}`, thread);
  }
  for (const pr of allThreads) {
    if (pr.subjectType !== "pr" || !pr.linkedRefs.length || pr.number == null) continue;
    for (const ref of pr.linkedRefs) {
      const issueThread = byRef.get(`${ref.repository}#${ref.number}`);
      if (!issueThread || issueThread === pr) continue;
      if (issueThread.linkedPrs.some((linked) => linked.number === pr.number && linked.repository === pr.repository)) continue;
      issueThread.linkedPrs.push({ number: pr.number, repository: pr.repository, url: pr.url, state: pr.state });
    }
  }

  const threads = allThreads.filter((thread) => {
    if (filters.unreadOnly && thread.unreadCount === 0) return false;
    if (!filters.includeDone && thread.done) return false;
    return true;
  });

  // Facets stay scoped to the same project so the dropdowns only offer values
  // that exist within this board.
  const facetScope = filters.projectId ? "AND project_id = $1" : "";
  const facetParams = filters.projectId ? [filters.projectId] : [];
  const facetRow = await query<{ repositories: string[] | null; actors: string[] | null; kinds: string[] | null }>(
    `SELECT
       (SELECT array_agg(DISTINCT repository ORDER BY repository) FROM changes WHERE repository IS NOT NULL ${facetScope}) AS repositories,
       (SELECT array_agg(DISTINCT actor_login ORDER BY actor_login) FROM changes WHERE actor_login IS NOT NULL ${facetScope}) AS actors,
       (SELECT array_agg(DISTINCT event_kind ORDER BY event_kind) FROM changes WHERE event_kind IS NOT NULL ${facetScope}) AS kinds`,
    facetParams,
  );

  const facets: ActivityFacets = {
    repositories: facetRow.rows[0]?.repositories ?? [],
    actors: facetRow.rows[0]?.actors ?? [],
    kinds: facetRow.rows[0]?.kinds ?? [],
  };

  return { threads, facets };
}

export async function markThreadRead(contentId: string) {
  await query(
    `INSERT INTO thread_reads (content_id, last_read_at, updated_at) VALUES ($1, now(), now())
     ON CONFLICT (content_id) DO UPDATE SET last_read_at = now(), updated_at = now()`,
    [contentId],
  );
}

export async function markAllThreadsRead() {
  await query(
    `INSERT INTO thread_reads (content_id, last_read_at, updated_at)
     SELECT DISTINCT content_id, now(), now() FROM changes WHERE content_id IS NOT NULL
     ON CONFLICT (content_id) DO UPDATE SET last_read_at = now(), updated_at = now()`,
  );
}

export async function setThreadDone(contentId: string, done: boolean) {
  await query(
    `INSERT INTO thread_reads (content_id, done, last_read_at, updated_at) VALUES ($1, $2, now(), now())
     ON CONFLICT (content_id) DO UPDATE SET done = $2, updated_at = now()`,
    [contentId, done],
  );
}
