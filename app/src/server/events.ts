// Normalizes the two raw change sources (GitHub webhooks and polling diffs)
// into one event taxonomy the Activity feed can reason about: a coarse `kind`,
// a specific `verb`, and the related/mentioned issues & PRs (`linkedRefs`).

export type EventKind = "pr" | "issue" | "review" | "comment" | "project" | "other";

export type LinkedRef = {
  relation: "closes" | "references";
  repository: string | null;
  number: number;
  url: string | null;
  title?: string | null;
};

export type NormalizedEvent = {
  eventKind: EventKind;
  eventVerb: string;
  linkedRefs: LinkedRef[];
};

// Issue/PR cross-references in free text: "closes #12", "fixes owner/repo#8",
// or a bare "#5". Closing keywords mark a `closes` relation; everything else
// is a plain reference.
const CLOSE_KEYWORDS = /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b/i;
const REF_PATTERN = /(\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s+)?(?:([\w.-]+\/[\w.-]+))?#(\d+)/gi;

export function extractRefs(body: string | null | undefined, fallbackRepo: string | null): LinkedRef[] {
  if (!body) return [];
  const refs = new Map<string, LinkedRef>();
  for (const match of body.matchAll(REF_PATTERN)) {
    const [, keyword, repo, numberText] = match;
    const number = Number.parseInt(numberText, 10);
    if (!Number.isFinite(number)) continue;
    const repository = repo ?? fallbackRepo;
    const relation: LinkedRef["relation"] = keyword && CLOSE_KEYWORDS.test(keyword) ? "closes" : "references";
    const key = `${repository ?? ""}#${number}`;
    // Prefer a "closes" relation if any mention of the same ref closes it.
    const existing = refs.get(key);
    if (existing && existing.relation === "closes") continue;
    refs.set(key, {
      relation,
      repository,
      number,
      url: repository ? `https://github.com/${repository}/issues/${number}` : null,
    });
  }
  return [...refs.values()];
}

export function reviewVerb(state: string | null | undefined): string {
  switch ((state ?? "").toUpperCase()) {
    case "APPROVED":
      return "review_approved";
    case "CHANGES_REQUESTED":
      return "review_changes_requested";
    case "DISMISSED":
      return "review_dismissed";
    default:
      return "review_commented";
  }
}

// OPEN -> CLOSED is "closed", anything -> MERGED is "merged", a closed thing
// reopening is "reopened"; otherwise a generic state move.
export function stateVerb(before: string | null | undefined, after: string | null | undefined): string {
  const a = (after ?? "").toUpperCase();
  const b = (before ?? "").toUpperCase();
  if (a === "MERGED") return "merged";
  if (a === "CLOSED") return "closed";
  if (a === "OPEN" && (b === "CLOSED" || b === "MERGED")) return "reopened";
  return "state_changed";
}

type Json = Record<string, unknown> | undefined;

function asObject(value: unknown): Json {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Maps a raw GitHub webhook (X-GitHub-Event + payload.action) onto the taxonomy.
export function normalizeWebhook(event: string, action: string, payload: Record<string, unknown>): NormalizedEvent {
  const repository = str(asObject(payload.repository)?.full_name) ?? null;

  switch (event) {
    case "pull_request": {
      const pr = asObject(payload.pull_request);
      const linkedRefs = extractRefs(str(pr?.body), repository);
      let verb = action;
      if (action === "closed") verb = pr?.merged ? "merged" : "closed";
      else if (action === "synchronize") verb = "commits_pushed";
      return { eventKind: "pr", eventVerb: verb, linkedRefs };
    }
    case "pull_request_review": {
      const pr = asObject(payload.pull_request);
      const review = asObject(payload.review);
      const verb = action === "dismissed" ? "review_dismissed" : reviewVerb(str(review?.state));
      return { eventKind: "review", eventVerb: verb, linkedRefs: extractRefs(str(pr?.body), repository) };
    }
    case "pull_request_review_comment":
      return { eventKind: "review", eventVerb: "review_comment", linkedRefs: [] };
    case "pull_request_review_thread":
      return { eventKind: "review", eventVerb: action === "resolved" ? "review_thread_resolved" : "review_thread_unresolved", linkedRefs: [] };
    case "issues": {
      const issue = asObject(payload.issue);
      return { eventKind: "issue", eventVerb: action, linkedRefs: extractRefs(str(issue?.body), repository) };
    }
    case "issue_comment": {
      const verb = action === "created" ? "commented" : action === "deleted" ? "comment_deleted" : "comment_edited";
      return { eventKind: "comment", eventVerb: verb, linkedRefs: [] };
    }
    case "projects_v2_item":
      return { eventKind: "project", eventVerb: `item_${action}`, linkedRefs: [] };
    case "push":
      return { eventKind: "other", eventVerb: "pushed", linkedRefs: [] };
    default:
      return { eventKind: "other", eventVerb: action ? `${event}_${action}` : event, linkedRefs: [] };
  }
}

// A poll snapshot of an issue/PR (comments & reviews stripped).
export type IssuePrSnapshot = {
  __typename?: string;
  title?: string | null;
  state?: string | null;
  assignees?: { nodes?: { login?: string }[] } | null;
  labels?: { nodes?: { name?: string }[] } | null;
} | null;

export type DiffEvent = {
  eventVerb: string;
  before: unknown;
  after: unknown;
};

function assigneeSet(snapshot: IssuePrSnapshot): Set<string> {
  return new Set((snapshot?.assignees?.nodes ?? []).map((node) => node.login).filter((login): login is string => Boolean(login)));
}

function labelSet(snapshot: IssuePrSnapshot): Set<string> {
  return new Set((snapshot?.labels?.nodes ?? []).map((node) => node.name).filter((name): name is string => Boolean(name)));
}

// Compares two issue/PR snapshots and emits one event per meaningful field
// change, so "got assigned" and "was merged" are distinct rows instead of one
// opaque "changed". Falls back to a generic "updated" when nothing specific
// is detectable but the snapshot hash moved.
export function diffIssuePr(before: IssuePrSnapshot, after: IssuePrSnapshot): DiffEvent[] {
  const events: DiffEvent[] = [];

  if ((before?.state ?? null) !== (after?.state ?? null)) {
    events.push({ eventVerb: stateVerb(before?.state, after?.state), before: before?.state ?? null, after: after?.state ?? null });
  }

  if ((before?.title ?? null) !== (after?.title ?? null)) {
    events.push({ eventVerb: "title_changed", before: before?.title ?? null, after: after?.title ?? null });
  }

  const beforeAssignees = assigneeSet(before);
  const afterAssignees = assigneeSet(after);
  const assignedAdded = [...afterAssignees].filter((login) => !beforeAssignees.has(login));
  const assignedRemoved = [...beforeAssignees].filter((login) => !afterAssignees.has(login));
  if (assignedAdded.length) events.push({ eventVerb: "assigned", before: null, after: assignedAdded });
  if (assignedRemoved.length) events.push({ eventVerb: "unassigned", before: assignedRemoved, after: null });

  const beforeLabels = labelSet(before);
  const afterLabels = labelSet(after);
  const labelsAdded = [...afterLabels].filter((name) => !beforeLabels.has(name));
  const labelsRemoved = [...beforeLabels].filter((name) => !afterLabels.has(name));
  if (labelsAdded.length) events.push({ eventVerb: "labeled", before: null, after: labelsAdded });
  if (labelsRemoved.length) events.push({ eventVerb: "unlabeled", before: labelsRemoved, after: null });

  // No fallback "updated" event: if nothing meaningful moved (typically just
  // the issue's updatedAt), we record nothing rather than noise.
  return events;
}

export function snapshotKind(snapshot: IssuePrSnapshot): EventKind {
  return snapshot?.__typename === "PullRequest" ? "pr" : "issue";
}

// Project board field values (status column, custom fields). Each node carries
// a field name and one typed value; flatten to name -> display string.
type FieldValueNode = {
  field?: { name?: string };
  text?: string;
  number?: number;
  date?: string;
  name?: string;
  users?: { nodes?: { login?: string }[] };
};

export function extractFields(nodes: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(nodes)) return result;
  for (const raw of nodes as FieldValueNode[]) {
    const field = raw?.field?.name;
    if (!field) continue;
    const value =
      raw.text ??
      (raw.number != null ? String(raw.number) : undefined) ??
      raw.date ??
      raw.name ??
      (raw.users?.nodes?.length ? raw.users.nodes.map((user) => user.login).filter(Boolean).join(", ") : undefined);
    if (value != null && value !== "") result[field] = value;
  }
  return result;
}

// Human-readable diff of board fields, e.g. "Status: Todo → In Review".
export function diffFields(beforeNodes: unknown, afterNodes: unknown): string {
  const before = extractFields(beforeNodes);
  const after = extractFields(afterNodes);
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const parts: string[] = [];
  for (const field of fields) {
    if (before[field] !== after[field]) parts.push(`${field}: ${before[field] ?? "—"} → ${after[field] ?? "—"}`);
  }
  return parts.join("; ");
}
