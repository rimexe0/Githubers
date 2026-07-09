"use client";

import { Brain, ChevronRight, CornerDownLeft, FileSearch, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "./utils";

export type ThinkingEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; label: string; status: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; thinking?: ThinkingEvent[]; streaming?: boolean; failed?: boolean };
export type Model = { id: string; free: boolean };
export type Conversation = { id: string; repo: string; model: string | null; profile: string | null; title: string | null; updated_at: string; message_count: number };

export const DEFAULT_MODEL = ""; // empty = daemon's plan-profile default
// The read-only default backend; empty profile resolves to this on the daemon.
export const PLAN_PROFILE = "opencode-plan";
// If no stream event arrives for this long, assume the model is stuck (free
// models can silently retry a rate limit with no output at all) and abort.
const INACTIVITY_TIMEOUT_MS = 70_000;

// "anthropic/claude-3.5" -> "anthropic"; ids with no slash fall in "other".
function providerOf(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : "other";
}

function modelLabel(id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(slash + 1) : id;
}

// Group models by provider, providers sorted alphabetically ("other" last).
function groupByProvider(models: Model[]): [string, Model[]][] {
  const groups = new Map<string, Model[]>();
  for (const model of models) {
    const provider = providerOf(model.id);
    const list = groups.get(provider) ?? [];
    list.push(model);
    groups.set(provider, list);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "other") return 1;
    if (b === "other") return -1;
    return a.localeCompare(b);
  });
}

// One independent chat, bound to a repo and (optionally) an existing
// conversation. Owns its own message thread, model, and stream lifecycle so
// many of these can tile side by side and run concurrently.
export function ChatWindow({
  repo,
  conversationId,
  model,
  models,
  onModelChange,
  profile,
  profiles,
  onProfileChange,
  onConversationCreated,
  onActivity,
}: {
  repo: string;
  conversationId: string | null;
  model: string;
  models: Model[];
  onModelChange: (model: string) => void;
  profile: string;
  profiles: string[];
  onProfileChange: (profile: string) => void;
  onConversationCreated: (id: string) => void;
  onActivity: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Live id: null until we've loaded (or created, on first send) a conversation.
  // Kept in a ref so `send` sees the latest value and so the load effect can
  // tell "the prop changed" from "we just created this id ourselves".
  const convRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip when the prop matches what we're already showing — notably right
    // after our own first send sets convRef, so we don't refetch and clobber
    // the freshly streamed reply.
    if (convRef.current === conversationId) return;
    convRef.current = conversationId;
    // A window's conversation only ever goes null → real (first send), never
    // back, so there's nothing to clear here — bail before touching state.
    if (!conversationId) return;
    let cancelled = false;
    api<{ conversation: Conversation; messages: { role: ChatMessage["role"]; content: string; thinking?: ThinkingEvent[] }[] }>(`/api/chat/${conversationId}`)
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages.map((message) => ({ role: message.role, content: message.content, thinking: message.thinking?.length ? message.thinking : undefined })));
        if (data.conversation.model) onModelChange(data.conversation.model);
        if (data.conversation.profile) onProfileChange(data.conversation.profile);
      })
      .catch((openError) => {
        if (!cancelled) setError(openError instanceof Error ? openError.message : "Failed to open conversation");
      });
    return () => {
      cancelled = true;
    };
    // onModelChange is stable enough for our purposes; re-run only on id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, sending]);

  const patchLastAssistant = (content: string, thinking: ThinkingEvent[], streaming: boolean, failed?: boolean) => {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", content, thinking: [...thinking], streaming, failed };
      return copy;
    });
  };

  const cancelSend = () => abortRef.current?.abort();

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !repo || sending) return;
    setError(null);
    setSending(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    let placeholderAdded = false;
    try {
      let liveConversationId = convRef.current;
      if (!liveConversationId) {
        const created = await api<{ id: string }>("/api/chat", {
          method: "POST",
          body: JSON.stringify({ repo, model: model || null, profile: profile || null }),
        });
        liveConversationId = created.id;
        convRef.current = created.id;
        onConversationCreated(created.id);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(`/api/chat/${liveConversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, model: model || null, profile: profile || null }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? "Chat failed");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: "", thinking: [], streaming: true }]);
      placeholderAdded = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let liveText = "";
      let streamFailed = false;
      const liveThinking: ThinkingEvent[] = [];

      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_TIMEOUT_MS);
      };
      resetInactivityTimer();

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          resetInactivityTimer();
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line) continue;
            let event: { type?: string; text?: string; tool?: string; label?: string; status?: string; reply?: string; thinking?: ThinkingEvent[]; message?: string };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.type === "reasoning" && event.text) liveThinking.push({ kind: "reasoning", text: event.text });
            else if (event.type === "tool") liveThinking.push({ kind: "tool", tool: event.tool ?? "tool", label: event.label ?? "", status: event.status ?? "" });
            else if (event.type === "text" && event.text) liveText += (liveText ? "\n\n" : "") + event.text;
            else if (event.type === "done") {
              if (event.reply) liveText = event.reply;
              if (Array.isArray(event.thinking) && event.thinking.length) {
                liveThinking.length = 0;
                liveThinking.push(...event.thinking);
              }
            } else if (event.type === "error") {
              streamFailed = true;
              setError(event.message ?? "Agent error");
            }
            patchLastAssistant(liveText, liveThinking, true);
          }
        }
      } catch (streamError) {
        streamFailed = true;
        const timedOut = controller.signal.aborted;
        setError(
          timedOut
            ? "No response for a while — the model may be rate-limited or stuck. Try again or pick another model."
            : streamError instanceof Error
              ? streamError.message
              : "Chat stream failed",
        );
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
      }

      patchLastAssistant(liveText || "(no response)", liveThinking, false, streamFailed);
      onActivity();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Chat failed");
      if (placeholderAdded) patchLastAssistant("", [], false, true);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [input, repo, sending, model, profile, onConversationCreated, onActivity]);

  const providerGroups = groupByProvider(models);
  // OpenCode backends are read-only and use the model picker; claude/codex are
  // full agents whose profile fixes the model, so the model picker is disabled.
  const isOpencodeProfile = !profile || profile.startsWith("opencode");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-0.5">
        {isOpencodeProfile ? (
          <span className="flex shrink-0 items-center gap-1 text-[0.6rem] text-[var(--ctp-green)]" title="The agent can read and search the repo but cannot modify it.">
            <Lock className="size-3" /> read-only
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[0.6rem] text-[var(--ctp-peach)]" title="Claude/Codex run as full agents and can edit files in the repo.">
            <Lock className="size-3" /> full agent · can edit
          </span>
        )}
        {/* Selectors: own full-width row on mobile (each shrinks + truncates), pushed
            right at natural width on desktop. */}
        <div className="flex w-full min-w-0 items-center gap-1.5 md:ml-auto md:w-auto">
          {profiles.length > 0 && (
            <Select value={profile || PLAN_PROFILE} onValueChange={(value) => onProfileChange(value === PLAN_PROFILE ? "" : value)}>
              <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 text-[0.7rem] md:w-auto md:flex-none" aria-label="Backend">
                <SelectValue placeholder="Backend" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((entry) => (
                  <SelectItem key={entry} value={entry} className="text-xs">
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={model || DEFAULT_MODEL} onValueChange={onModelChange} disabled={!isOpencodeProfile}>
            <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 text-[0.7rem] md:w-52 md:flex-none" aria-label="Model">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL} className="text-xs">Default (plan profile)</SelectItem>
              {providerGroups.map(([provider, providerModels]) => (
                <SelectGroup key={provider}>
                  <SelectLabel className="text-[0.6rem] capitalize">{provider}</SelectLabel>
                  {providerModels.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} className="text-xs">
                      {modelLabel(entry.id)}
                      {entry.free && <span className="text-[var(--ctp-green)]"> · free</span>}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {models.find((entry) => entry.id === model)?.free && (
        <div className="shrink-0 px-0.5 text-[0.55rem] text-[var(--ctp-yellow)]">Free models can be slow or hit their usage limit — the request stops itself if it stalls.</div>
      )}

      <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-border p-2.5">
        {messages.length === 0 && !sending && (
          <div className="m-auto max-w-sm px-2 text-center text-[0.7rem] text-muted-foreground">
            Ask anything about <span className="font-semibold text-foreground">{repo}</span> — architecture, where a feature lives, how something works. The agent reads the real code (read-only).
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-1"}>
            {message.role === "assistant" && message.thinking && message.thinking.length > 0 && (
              <ThinkingBlock events={message.thinking} defaultOpen={message.streaming} />
            )}
            {(message.content || message.role === "user" || !message.streaming) && (
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  message.role === "user"
                    ? "bg-[var(--ctp-blue)] text-[var(--ctp-base)]"
                    : message.failed
                      ? "border border-destructive/40 bg-destructive/10 text-foreground"
                      : "bg-[var(--ctp-mantle)] text-foreground"
                }`}
              >
                {message.content}
                {message.streaming && message.content && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle" />}
              </div>
            )}
            {message.role === "assistant" && message.streaming && !message.content && (
              <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> working…
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-[0.7rem] text-destructive">{error}</div>}

      <div className="flex shrink-0 items-end gap-1.5">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={repo ? `Ask about ${repo}…` : "Select a repo first"}
          className="max-h-40 min-h-10 flex-1 text-xs"
          disabled={!repo || sending}
        />
        {sending ? (
          <Button type="button" size="sm" variant="secondary" onClick={cancelSend}>
            <Loader2 className="size-3.5 animate-spin" />
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={send} disabled={!repo || !input.trim()}>
            <CornerDownLeft className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// Collapsible trace of what the agent did: its reasoning and the files it
// read/searched (read-only). Auto-opens while streaming so thoughts appear live.
function ThinkingBlock({ events, defaultOpen }: { events: ThinkingEvent[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const toolCount = events.filter((event) => event.kind === "tool").length;
  const reasoningCount = events.length - toolCount;

  return (
    <div className="w-full max-w-[85%] rounded-lg border border-border bg-[var(--ctp-crust)]/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[0.65rem] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} />
        <Brain className="size-3" />
        <span>Thinking</span>
        <span className="text-[0.6rem]">· {reasoningCount} thought{reasoningCount === 1 ? "" : "s"}, {toolCount} file op{toolCount === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border px-2 py-1.5">
          {events.map((event, index) =>
            event.kind === "reasoning" ? (
              <p key={index} className="whitespace-pre-wrap text-[0.65rem] leading-relaxed text-muted-foreground">
                {event.text}
              </p>
            ) : (
              <div key={index} className="flex items-center gap-1.5 text-[0.65rem] text-[var(--ctp-subtext0)]">
                <FileSearch className="size-3 shrink-0 text-[var(--ctp-blue)]" />
                <span className="font-medium">{event.tool}</span>
                {event.label && <span className="truncate text-muted-foreground">{event.label}</span>}
                {event.status && event.status !== "completed" && <span className="text-[var(--ctp-yellow)]">{event.status}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
