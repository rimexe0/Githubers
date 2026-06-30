"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FolderGit2,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Inbox,
  Link2,
  MessageSquare,
  Pencil,
  Tag,
  UserMinus,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActivityEvent, ActivityResponse, ActivityThread, LinkedRef, SyncRun } from "./types";
import { api, relativeTime, stateClass } from "./utils";

type VerbMeta = { icon: LucideIcon; color: string; label: string };

const VERB_META: Record<string, VerbMeta> = {
  opened: { icon: CircleDot, color: "var(--ctp-green)", label: "opened" },
  reopened: { icon: CircleDot, color: "var(--ctp-green)", label: "reopened" },
  ready_for_review: { icon: CircleDot, color: "var(--ctp-green)", label: "marked ready" },
  closed: { icon: XCircle, color: "var(--ctp-red)", label: "closed" },
  merged: { icon: GitMerge, color: "var(--ctp-mauve)", label: "merged" },
  converted_to_draft: { icon: GitPullRequest, color: "var(--ctp-overlay1)", label: "converted to draft" },
  state_changed: { icon: CircleDot, color: "var(--ctp-overlay1)", label: "state changed" },
  title_changed: { icon: Pencil, color: "var(--ctp-yellow)", label: "renamed" },
  edited: { icon: Pencil, color: "var(--ctp-yellow)", label: "edited" },
  updated: { icon: Pencil, color: "var(--ctp-overlay1)", label: "updated" },
  assigned: { icon: UserPlus, color: "var(--ctp-blue)", label: "assigned" },
  unassigned: { icon: UserMinus, color: "var(--ctp-overlay1)", label: "unassigned" },
  labeled: { icon: Tag, color: "var(--ctp-yellow)", label: "labeled" },
  unlabeled: { icon: Tag, color: "var(--ctp-overlay1)", label: "unlabeled" },
  commented: { icon: MessageSquare, color: "var(--ctp-blue)", label: "commented" },
  comment_edited: { icon: MessageSquare, color: "var(--ctp-overlay1)", label: "edited a comment" },
  comment_deleted: { icon: MessageSquare, color: "var(--ctp-red)", label: "deleted a comment" },
  review_approved: { icon: CheckCircle2, color: "var(--ctp-green)", label: "approved" },
  review_changes_requested: { icon: XCircle, color: "var(--ctp-red)", label: "requested changes" },
  review_commented: { icon: MessageSquare, color: "var(--ctp-blue)", label: "reviewed" },
  review_dismissed: { icon: XCircle, color: "var(--ctp-overlay1)", label: "review dismissed" },
  review_comment: { icon: MessageSquare, color: "var(--ctp-blue)", label: "review comment" },
  review_requested: { icon: GitPullRequest, color: "var(--ctp-yellow)", label: "requested review" },
  review_thread_resolved: { icon: Check, color: "var(--ctp-green)", label: "resolved a thread" },
  review_thread_unresolved: { icon: CircleDot, color: "var(--ctp-yellow)", label: "unresolved a thread" },
  commits_pushed: { icon: GitCommit, color: "var(--ctp-blue)", label: "pushed commits" },
  pushed: { icon: GitCommit, color: "var(--ctp-blue)", label: "pushed" },
  item_added: { icon: FolderGit2, color: "var(--ctp-teal)", label: "added to project" },
  fields_changed: { icon: FolderGit2, color: "var(--ctp-lavender)", label: "board fields changed" },
};

function verbMeta(verb: string | null): VerbMeta {
  if (verb && VERB_META[verb]) return VERB_META[verb];
  if (verb?.startsWith("item_")) return { icon: FolderGit2, color: "var(--ctp-lavender)", label: verb.replace(/_/g, " ") };
  return { icon: AlertCircle, color: "var(--ctp-overlay1)", label: verb?.replace(/_/g, " ") ?? "changed" };
}

function subjectIcon(subjectType: string, state: string | null): VerbMeta {
  if (subjectType === "pr") return { icon: GitPullRequest, color: stateColor(state), label: "PR" };
  if (subjectType === "issue") return { icon: CircleDot, color: stateColor(state), label: "issue" };
  if (subjectType === "project") return { icon: FolderGit2, color: "var(--ctp-lavender)", label: "project" };
  return { icon: Inbox, color: "var(--ctp-overlay1)", label: "" };
}

// An issue closed because a linked PR merged should read as a merge (purple),
// not a plain close (red).
function effectiveState(thread: ActivityThread): string | null {
  if (thread.state === "CLOSED" && thread.linkedPrs.some((pr) => pr.state === "MERGED")) return "MERGED";
  return thread.state;
}

function stateColor(state: string | null): string {
  if (state === "MERGED") return "var(--ctp-mauve)";
  if (state === "CLOSED") return "var(--ctp-red)";
  if (state === "OPEN") return "var(--ctp-green)";
  return "var(--ctp-overlay1)";
}

function asList(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

const MESSAGE_VERBS = new Set(["commented", "comment_edited", "review_approved", "review_changes_requested", "review_commented", "review_comment", "review_dismissed"]);

function isMessage(event: ActivityEvent): boolean {
  return Boolean(event.verb && MESSAGE_VERBS.has(event.verb) && event.summary && event.summary.trim());
}

// The compact change description shown on the event's header line (state moves
// say it all via their label, so they render nothing here).
function InlineDiff({ event }: { event: ActivityEvent }) {
  const verb = event.verb;
  if (verb === "title_changed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <span className="line-through opacity-70">{asList(event.before)}</span>
        <ChevronRight className="size-3" />
        <span>{asList(event.after)}</span>
      </span>
    );
  }
  if (verb === "assigned" || verb === "labeled") return <span className="text-[var(--ctp-green)]">+ {asList(event.after)}</span>;
  if (verb === "unassigned" || verb === "unlabeled") return <span className="text-[var(--ctp-red)]">− {asList(event.before)}</span>;
  if (verb === "fields_changed" && event.summary) return <span className="text-muted-foreground">{event.summary}</span>;
  return null;
}

function MessageBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = body.length > 280 || body.includes("\n");
  return (
    <div className="mt-1 ml-5 rounded border-l-2 border-border pl-2">
      <p className={`text-[0.7rem] break-words whitespace-pre-wrap text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}>{body}</p>
      {long && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-0.5 text-[0.6rem] text-[var(--ctp-blue)] hover:underline">
          {expanded ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const meta = verbMeta(event.verb);
  const message = isMessage(event);
  return (
    <div className={`min-w-0 rounded px-1 py-1 text-[0.7rem] ${event.unread ? "bg-[var(--ctp-mauve)]/5" : ""}`}>
      <div className="flex min-w-0 items-baseline gap-2">
        <meta.icon className="size-3 shrink-0 translate-y-0.5" style={{ color: meta.color }} />
        <span className="max-w-[50%] shrink-0 truncate font-medium" style={{ color: meta.color }}>{event.actor ?? "someone"}</span>
        <span className="shrink-0 text-muted-foreground">{meta.label}</span>
        {!message && (
          <span className="min-w-0 flex-1 truncate">
            {event.url ? (
              <a href={event.url} target="_blank" rel="noreferrer" className="hover:underline">
                <InlineDiff event={event} />
              </a>
            ) : (
              <InlineDiff event={event} />
            )}
          </span>
        )}
        {message && <span className="flex-1" />}
        {event.source === "webhook" && <span className="shrink-0 text-[0.55rem] text-[var(--ctp-teal)] uppercase">live</span>}
        <span className="shrink-0 text-muted-foreground tabular-nums">{relativeTime(event.occurredAt)}</span>
      </div>
      {message && event.summary && <MessageBody body={event.summary} />}
    </div>
  );
}

function RefChips({ refs }: { refs: LinkedRef[] }) {
  if (!refs.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {refs.map((ref) => {
        const label = `${ref.relation === "closes" ? "closes" : "ref"} #${ref.number}`;
        const content = (
          <Badge variant="outline" className="h-4 gap-1 px-1 text-[0.6rem]">
            <Link2 className="size-2.5" />
            {label}
          </Badge>
        );
        return ref.url ? (
          <a key={`${ref.repository}#${ref.number}`} href={ref.url} target="_blank" rel="noreferrer">
            {content}
          </a>
        ) : (
          <span key={`${ref.repository}#${ref.number}`}>{content}</span>
        );
      })}
    </span>
  );
}

function ThreadCard({
  thread,
  expanded,
  onToggle,
  onDone,
}: {
  thread: ActivityThread;
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const state = effectiveState(thread);
  const subject = subjectIcon(thread.subjectType, state);
  const SubjectIcon = subject.icon;
  const latest = thread.events[0];
  const latestMeta = verbMeta(latest?.verb ?? null);

  return (
    <div className={`rounded-md border ${thread.unreadCount ? "border-[var(--ctp-mauve)]/40 bg-card" : "border-transparent bg-card"}`}>
      <button type="button" onClick={onToggle} className="flex w-full flex-col gap-1 px-2 py-1.5 text-left text-xs hover:bg-accent">
        {/* Metadata row wraps onto extra lines instead of overflowing. */}
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          {expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
          <SubjectIcon className="size-3.5 shrink-0" style={{ color: subject.color }} />
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {thread.repository ? thread.repository.split("/")[1] : ""}
            {thread.number != null ? `#${thread.number}` : ""}
          </span>
          {state && <span className={`${stateClass(state)} shrink-0`}>{state.toLowerCase()}</span>}
          <RefChips refs={thread.linkedRefs} />
          {thread.unreadCount > 0 && (
            <Badge className="h-4 bg-[var(--ctp-mauve)] px-1.5 text-[0.6rem] text-[var(--ctp-base)]">{thread.unreadCount} new</Badge>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <latestMeta.icon className="size-3" style={{ color: latestMeta.color }} />
            {relativeTime(thread.lastEventAt)}
          </span>
        </div>
        {/* Full title on its own line — wraps, never truncated. */}
        <div className={`w-full pl-5 leading-snug break-words ${thread.unreadCount ? "font-medium text-foreground" : "text-muted-foreground"}`}>
          {thread.title ?? "Untitled"}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between">
            {thread.url ? (
              <a className="text-[0.65rem] text-[var(--ctp-blue)] hover:underline" href={thread.url} target="_blank" rel="noreferrer">
                open on github →
              </a>
            ) : (
              <span />
            )}
            {thread.contentId && (
              <Button type="button" size="xs" variant="ghost" onClick={onDone} className="h-5 gap-1 px-1.5 text-[0.65rem]">
                <Check className="size-3" /> {thread.done ? "reopen" : "mark done"}
              </Button>
            )}
          </div>
          {thread.linkedPrs.length > 0 && (
            <div className="mb-1 flex flex-col gap-0.5 border-l-2 border-[var(--ctp-surface1)] pl-2">
              {thread.linkedPrs.map((pr) => (
                <a
                  key={`${pr.repository}#${pr.number}`}
                  href={pr.url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[0.65rem] hover:underline"
                >
                  <GitPullRequest className="size-3 shrink-0 text-[var(--ctp-mauve)]" />
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {pr.repository ? `${pr.repository.split("/")[1]}#${pr.number}` : `#${pr.number}`}
                  </span>
                  {pr.state && <span className={`ml-auto shrink-0 ${stateClass(pr.state)}`}>{pr.state.toLowerCase()}</span>}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-px">
            {thread.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Fully controlled: the pane header (in ProjectBoard) owns kind/unreadOnly/
// includeDone and mark-all-read (via reloadKey), and reads the unread count
// back through onStats. Activity just fetches and renders.
export function Activity({
  syncRuns = [],
  active,
  refreshKey,
  projectId,
  actor,
  search,
  kind = "",
  unreadOnly = false,
  includeDone = false,
  reloadKey = 0,
  onStats,
}: {
  syncRuns?: SyncRun[];
  active: boolean;
  refreshKey: number;
  projectId?: string;
  actor?: string;
  search?: string;
  kind?: string;
  unreadOnly?: boolean;
  includeDone?: boolean;
  reloadKey?: number;
  onStats?: (unread: number) => void;
}) {
  const [data, setData] = useState<ActivityResponse>({ threads: [], facets: { repositories: [], actors: [], kinds: [] } });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const latestSync = syncRuns[0];

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (kind) params.set("kind", kind);
    if (actor) params.set("actor", actor);
    if (search) params.set("search", search);
    if (unreadOnly) params.set("unreadOnly", "true");
    if (includeDone) params.set("includeDone", "true");
    return params.toString();
  }, [projectId, kind, actor, search, unreadOnly, includeDone]);

  const load = useCallback(async () => {
    const response = await api<ActivityResponse>(`/api/activity${queryString ? `?${queryString}` : ""}`);
    setData(response);
    setLoaded(true);
    onStats?.(response.threads.reduce((total, thread) => total + thread.unreadCount, 0));
  }, [queryString, onStats]);

  // Debounce so flipping filters / typing in the board search doesn't hammer the API.
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void load().catch(() => {}), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [active, load, search, refreshKey, reloadKey]);

  const toggle = async (thread: ActivityThread) => {
    const next = new Set(expanded);
    if (next.has(thread.key)) {
      next.delete(thread.key);
    } else {
      next.add(thread.key);
      if (thread.contentId && thread.unreadCount > 0) {
        // Optimistically clear unread, update the header count, then persist.
        setData((current) => {
          const threads = current.threads.map((item) =>
            item.key === thread.key ? { ...item, unreadCount: 0, events: item.events.map((event) => ({ ...event, unread: false })) } : item,
          );
          onStats?.(threads.reduce((total, item) => total + item.unreadCount, 0));
          return { ...current, threads };
        });
        api("/api/activity/read", { method: "POST", body: JSON.stringify({ contentId: thread.contentId }) }).catch(() => {});
      }
    }
    setExpanded(next);
  };

  const setDone = async (thread: ActivityThread) => {
    if (!thread.contentId) return;
    await api("/api/activity/done", { method: "POST", body: JSON.stringify({ contentId: thread.contentId, done: !thread.done }) });
    await load();
  };

  const noWebhookEvents = loaded && !data.threads.some((thread) => thread.events.some((event) => event.source === "webhook"));

  return (
    <div className="flex h-full flex-col gap-2">
      {latestSync?.error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">Last sync failed: {latestSync.error}</div>}

      {noWebhookEvents && (
        <div className="shrink-0 rounded-md bg-[var(--ctp-yellow)]/10 px-2 py-1 text-[0.7rem] text-[var(--ctp-yellow)]">
          No live webhook events yet. Configure a GitHub webhook (Settings → webhook secret) for real-time reviews, merges, and comments.
        </div>
      )}

      {/* Plain block scroller (not Radix ScrollArea): its viewport sizes to
          max-content, which lets flex rows ignore the pane width and overflow.
          A block container forces children to truncate/wrap at the pane edge. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1">
          {data.threads.map((thread) => (
            <ThreadCard key={thread.key} thread={thread} expanded={expanded.has(thread.key)} onToggle={() => toggle(thread)} onDone={() => setDone(thread)} />
          ))}
          {loaded && !data.threads.length && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {kind || unreadOnly || search ? "No activity matches these filters." : "No activity captured yet. Run sync after configuring a token and project."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
