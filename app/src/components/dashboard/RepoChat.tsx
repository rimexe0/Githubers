"use client";

import { Brain, ChevronRight, CornerDownLeft, FileSearch, Loader2, Lock, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Settings } from "./types";
import { api, relativeTime } from "./utils";

type ThinkingEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; label: string; status: string };
type ChatMessage = { role: "user" | "assistant"; content: string; thinking?: ThinkingEvent[]; streaming?: boolean; failed?: boolean };
type Model = { id: string; free: boolean };
type Conversation = { id: string; repo: string; model: string | null; title: string | null; updated_at: string; message_count: number };

const DEFAULT_MODEL = ""; // empty = daemon's plan-profile default
// If no stream event arrives for this long, assume the model is stuck (free
// models can silently retry a rate limit with no output at all) and abort.
const INACTIVITY_TIMEOUT_MS = 70_000;

export function RepoChat({ settings }: { settings: Settings }) {
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const enabled = settings.automatorEnabled;
  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    api<{ repos: string[] }>("/api/automator/chat")
      .then((data) => {
        setRepos(data.repos);
        setRepo((current) => current || data.repos[0] || "");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load repos"));
    api<{ models: Model[] }>("/api/automator/models")
      .then((data) => setModels(data.models))
      .catch(() => setModels([]));
  }, [enabled]);

  const loadConversations = useCallback(async (forRepo: string) => {
    if (!forRepo) return;
    try {
      setConversations(await api<Conversation[]>(`/api/chat?repo=${encodeURIComponent(forRepo)}`));
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    if (repo) void Promise.resolve().then(() => loadConversations(repo));
  }, [repo, loadConversations]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, sending]);

  const changeRepo = (value: string) => {
    setRepo(value);
    setActiveId(null);
    setMessages([]);
    setError(null);
    setMobileListOpen(false);
  };

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setMobileListOpen(false);
  };

  const openConversation = async (id: string) => {
    setError(null);
    setMobileListOpen(false);
    try {
      const data = await api<{ conversation: Conversation; messages: { role: ChatMessage["role"]; content: string; thinking?: ThinkingEvent[] }[] }>(`/api/chat/${id}`);
      setActiveId(id);
      setMessages(data.messages.map((message) => ({ role: message.role, content: message.content, thinking: message.thinking?.length ? message.thinking : undefined })));
      if (data.conversation.model) setModel(data.conversation.model);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open conversation");
    }
  };

  const removeConversation = async (id: string) => {
    await api(`/api/chat/${id}`, { method: "DELETE" });
    if (activeId === id) newChat();
    await loadConversations(repo);
  };

  // Update the last (assistant) message in place as stream events arrive.
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
      let conversationId = activeId;
      if (!conversationId) {
        const created = await api<{ id: string }>("/api/chat", {
          method: "POST",
          body: JSON.stringify({ repo, model: model || null }),
        });
        conversationId = created.id;
        setActiveId(conversationId);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(`/api/chat/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text, model: model || null }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? "Chat failed");
      }

      // Live assistant message updated as NDJSON events stream in.
      setMessages((prev) => [...prev, { role: "assistant", content: "", thinking: [], streaming: true }]);
      placeholderAdded = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let liveText = "";
      let streamFailed = false;
      const liveThinking: ThinkingEvent[] = [];

      // The daemon has its own stall/rate-limit backstop, but this is a second
      // line of defense in case the hang happens before any bytes reach us at
      // all (e.g. the daemon itself is unreachable mid-request).
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
      await loadConversations(repo);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Chat failed");
      if (placeholderAdded) patchLastAssistant("", [], false, true);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [input, repo, sending, activeId, model, loadConversations]);

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        <div className="max-w-md space-y-2">
          <p className="font-semibold text-foreground">AgentAutomator is not enabled.</p>
          <p>Enable it and map at least one repo to a local clone path in <span className="font-semibold">Settings → Agent automator</span>, then chat about that repo here.</p>
        </div>
      </div>
    );
  }

  const freeModels = models.filter((entry) => entry.free);
  const paidModels = models.filter((entry) => !entry.free);

  const repoPicker = (
    <Select value={repo} onValueChange={changeRepo}>
      <SelectTrigger size="sm" className="h-7 w-full min-w-0 flex-1 text-xs" aria-label="Repository">
        <SelectValue placeholder={repos.length ? "Repo" : "No repos"} />
      </SelectTrigger>
      <SelectContent>
        {repos.map((name) => (
          <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const conversationList = (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {conversations.length === 0 && <div className="px-1.5 py-2 text-[0.6rem] text-muted-foreground">No conversations yet.</div>}
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className={`group flex items-center gap-1 rounded px-1.5 py-1 ${conversation.id === activeId ? "bg-accent" : "hover:bg-accent/50"}`}
        >
          <button type="button" onClick={() => openConversation(conversation.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate text-xs">{conversation.title || "Untitled chat"}</div>
            <div className="text-[0.55rem] text-muted-foreground">{conversation.message_count} msgs · {relativeTime(conversation.updated_at)} ago</div>
          </button>
          <button
            type="button"
            onClick={() => removeConversation(conversation.id)}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 md:flex-row">
      {/* Desktop conversation rail */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 rounded-md border border-border p-1 md:flex">
        <div className="flex items-center gap-1 px-1 py-0.5">
          {repoPicker}
          <Button type="button" size="xs" variant="secondary" className="shrink-0" onClick={newChat} title="New chat"><Plus className="size-3" /></Button>
        </div>
        {conversationList}
      </aside>

      {/* Chat column */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {/* Mobile toolbar: repo picker + new + history toggle */}
        <div className="flex items-center gap-1 md:hidden">
          {repoPicker}
          <Button type="button" size="xs" variant="secondary" className="shrink-0" onClick={newChat} title="New chat"><Plus className="size-3" /></Button>
          <Button type="button" size="xs" variant={mobileListOpen ? "default" : "secondary"} className="shrink-0" onClick={() => setMobileListOpen((v) => !v)} title="Conversations">
            <MessageSquare className="size-3" />
          </Button>
        </div>
        {mobileListOpen && (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border p-1 md:hidden">{conversationList}</div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[0.65rem] text-[var(--ctp-green)]" title="The agent can read and search the repo but cannot modify it.">
            <Lock className="size-3" /> read-only
          </span>
          <Select value={model || DEFAULT_MODEL} onValueChange={(value) => setModel(value)}>
            <SelectTrigger size="sm" className="ml-auto h-7 w-full min-w-0 flex-1 text-xs md:w-56 md:flex-none" aria-label="Model">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL} className="text-xs">Default (plan profile)</SelectItem>
              {freeModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[0.6rem]">Free</SelectLabel>
                  {freeModels.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} className="text-xs">
                      {entry.id} <span className="text-[var(--ctp-green)]">· free</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {paidModels.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[0.6rem]">Paid</SelectLabel>
                  {paidModels.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id} className="text-xs">{entry.id}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        {models.find((entry) => entry.id === model)?.free && (
          <div className="shrink-0 text-[0.6rem] text-[var(--ctp-yellow)]">Free models can be slow or hit their usage limit — the request stops itself if it stalls.</div>
        )}

        <div ref={threadRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {repos.length === 0 && (
            <div className="text-[0.65rem] text-muted-foreground">No repos mapped. Add `owner/repo=/local/path` lines in Settings → Agent automator.</div>
          )}
          {repos.length > 0 && messages.length === 0 && !sending && (
            <div className="m-auto max-w-sm px-2 text-center text-xs text-muted-foreground">
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
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-xs leading-relaxed ${
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

        {error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}

        <div className="flex shrink-0 items-end gap-2">
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
            className="max-h-40 min-h-11 flex-1 text-xs"
            disabled={!repo || sending}
          />
          {sending ? (
            <Button type="button" size="sm" variant="secondary" onClick={cancelSend}>
              <Loader2 className="size-3.5 animate-spin" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={send} disabled={!repo || !input.trim()}>
              <CornerDownLeft className="size-3.5" />
              <span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Collapsible trace of what the agent did: its reasoning and the files it
// read/searched (read-only). Auto-opens while streaming so thoughts appear live.
function ThinkingBlock({ events, defaultOpen }: { events: ThinkingEvent[]; defaultOpen?: boolean }) {
  // Initialised from defaultOpen: the block first mounts while streaming (open),
  // and keeps the user's later choice once the turn finishes.
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
