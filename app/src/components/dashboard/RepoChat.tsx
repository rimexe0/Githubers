"use client";

import { ChevronDown, ChevronRight, FolderGit2, MessageSquarePlus, Plus, Trash2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { Button } from "@/components/ui/button";
import { ChatWindow, type ChatSpawn, type Conversation, DEFAULT_MODEL, type Model } from "./ChatWindow";
import {
  insertAsNewLane,
  insertInLane,
  type LaneLayout,
  loadSizeMap,
  locate,
  persist,
  removeFromLayout,
  ResizeHandle,
} from "./tiling";
import type { Settings } from "./types";
import { api, relativeTime, repoAccent } from "./utils";

// A tab is one conversation (or a not-yet-created "new chat"). The repo lives on
// the tab, so a group can freely mix repos — the active tab decides the context.
// `seedPrompt` is set only on a spawned tab: its ChatWindow auto-sends it as the
// first message, then clears it back to undefined so a reload can't resend.
type Tab = { id: string; repo: string; conversationId: string | null; model: string; profile?: string; seedPrompt?: string };
// A group is a tabbed pane: an ordered set of tabs with one active.
type Group = { id: string; tabIds: string[]; activeId: string | null };
type Dir = "center" | "left" | "right" | "top" | "bottom";
type Drag = { kind: "tab"; tabId: string; fromGroup: string } | { kind: "conv"; repo: string; conversationId: string };

const TABS_KEY = "chat-workspace-tabs";
const GROUPS_KEY = "chat-workspace-groups";
const LAYOUT_KEY = "chat-workspace-layout";
const HEIGHTS_KEY = "chat-workspace-groupheights";
const BASIS_KEY = "chat-workspace-lanebasis";
const DEFAULT_BASIS = 380;
// Mirror of the daemon's cap: never fan out more than 5 chats from one turn.
const MAX_SPAWNS = 5;

function loadStored<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Which region of a pane the pointer is over, for the split preview.
function regionFromEvent(event: React.DragEvent): Dir {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (x > 0.3 && x < 0.7 && y > 0.3 && y < 0.7) return "center";
  const edges: Record<Exclude<Dir, "center">, number> = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  return (Object.keys(edges) as Exclude<Dir, "center">[]).reduce((a, b) => (edges[b] < edges[a] ? b : a));
}

function regionStyle(dir: Dir): React.CSSProperties {
  switch (dir) {
    case "left":
      return { inset: "0 50% 0 0" };
    case "right":
      return { inset: "0 0 0 50%" };
    case "top":
      return { inset: "0 0 50% 0" };
    case "bottom":
      return { inset: "50% 0 0 0" };
    default:
      return { inset: 0 };
  }
}

export function RepoChat({ settings }: { settings: Settings }) {
  const enabled = settings.automatorEnabled;
  const isDesktop = useIsDesktop();
  const [repos, setRepos] = useState<string[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoaded, setConvLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [tabs, setTabs] = useState<Record<string, Tab>>(() => {
    const stored = loadStored<Tab[]>(TABS_KEY);
    return stored ? Object.fromEntries(stored.map((tab) => [tab.id, tab])) : {};
  });
  const [groups, setGroups] = useState<Record<string, Group>>(() => {
    const stored = loadStored<Group[]>(GROUPS_KEY);
    return stored ? Object.fromEntries(stored.map((group) => [group.id, group])) : {};
  });
  const [layout, setLayout] = useState<LaneLayout>(() => loadStored<LaneLayout>(LAYOUT_KEY) ?? []);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupHeights, setGroupHeights] = useState<Record<string, number>>(() => loadSizeMap(HEIGHTS_KEY));
  const [laneBasis, setLaneBasis] = useState<Record<string, number>>(() => loadSizeMap(BASIS_KEY));

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = drag !== null;
  const clearDrag = () => setDrag(null);

  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}${(idCounter.current += 1)}-${Date.now().toString(36)}`;

  // --- data loading ---
  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api<Conversation[]>("/api/chat"));
    } catch {
      setConversations([]);
    } finally {
      setConvLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    api<{ repos: string[] }>("/api/automator/chat")
      .then((data) => {
        setRepos(data.repos);
        setExpanded((prev) => (prev.size ? prev : new Set(data.repos.slice(0, 1))));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load repos"));
    api<{ models: Model[] }>("/api/automator/models")
      .then((data) => setModels(data.models))
      .catch(() => setModels([]));
    api<{ profiles: string[] }>("/api/automator/config")
      .then((data) => setProfiles(data.profiles ?? []))
      .catch(() => setProfiles([]));
    void Promise.resolve().then(() => loadConversations());
  }, [enabled, loadConversations]);

  // Reconcile localStorage-restored state against live repos/conversations, once
  // conversations have actually loaded so real tabs aren't mistaken for orphans.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!enabled || reconciledRef.current || repos.length === 0 || !convLoaded) return;
    reconciledRef.current = true;
    const convIds = new Set(conversations.map((c) => c.id));
    const keptTabs: Record<string, Tab> = {};
    for (const tab of Object.values(tabs)) {
      if (tab.conversationId && !convIds.has(tab.conversationId)) continue;
      if (!repos.includes(tab.repo)) continue;
      keptTabs[tab.id] = tab;
    }
    const keptGroups: Record<string, Group> = {};
    for (const group of Object.values(groups)) {
      const tabIds = group.tabIds.filter((id) => keptTabs[id]);
      if (!tabIds.length) continue;
      keptGroups[group.id] = { ...group, tabIds, activeId: tabIds.includes(group.activeId ?? "") ? group.activeId : tabIds[0] };
    }
    let nextLayout = layout.map((lane) => lane.filter((id) => keptGroups[id])).filter((lane) => lane.length);
    // Place any surviving groups the stored layout forgot.
    const placed = new Set(nextLayout.flat());
    for (const id of Object.keys(keptGroups)) if (!placed.has(id)) nextLayout.push([id]);

    if (Object.keys(keptGroups).length === 0) {
      const tab: Tab = { id: nextId("t"), repo: repos[0], conversationId: null, model: DEFAULT_MODEL };
      const group: Group = { id: nextId("g"), tabIds: [tab.id], activeId: tab.id };
      keptTabs[tab.id] = tab;
      keptGroups[group.id] = group;
      nextLayout = [[group.id]];
    }
    setTabs(keptTabs);
    setGroups(keptGroups);
    setLayout(nextLayout);
    setActiveGroupId(nextLayout[0]?.[0] ?? null);
    // Reads tabs/groups/layout from closure on purpose — runs exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, repos, conversations, convLoaded]);

  // --- persistence ---
  useEffect(() => {
    if (reconciledRef.current) persist(TABS_KEY, Object.values(tabs));
  }, [tabs]);
  useEffect(() => {
    if (reconciledRef.current) persist(GROUPS_KEY, Object.values(groups));
  }, [groups]);
  useEffect(() => {
    if (reconciledRef.current) persist(LAYOUT_KEY, layout);
  }, [layout]);

  // --- helpers ---
  const groupOfTab = useCallback((tabId: string) => Object.values(groups).find((group) => group.tabIds.includes(tabId))?.id ?? null, [groups]);
  const openTabIds = useMemo(() => new Set(Object.values(tabs).map((tab) => tab.conversationId).filter(Boolean)), [tabs]);

  const patchTab = (id: string, patch: Partial<Tab>) => setTabs((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));

  // Add a tab into the active group (creating a first group if the canvas is
  // empty). This is the "normal tab" open — no splitting.
  const addTabToActiveGroup = (tab: Tab) => {
    setTabs((prev) => ({ ...prev, [tab.id]: tab }));
    const targetId = activeGroupId && groups[activeGroupId] ? activeGroupId : layout[0]?.[0] ?? null;
    if (!targetId) {
      const group: Group = { id: nextId("g"), tabIds: [tab.id], activeId: tab.id };
      setGroups((prev) => ({ ...prev, [group.id]: group }));
      setLayout([[group.id]]);
      setActiveGroupId(group.id);
      return;
    }
    setGroups((prev) => {
      const group = prev[targetId];
      if (!group) return prev;
      return { ...prev, [targetId]: { ...group, tabIds: [...group.tabIds, tab.id], activeId: tab.id } };
    });
    setActiveGroupId(targetId);
  };

  const openConversation = (repo: string, conversationId: string) => {
    const existing = Object.values(tabs).find((tab) => tab.conversationId === conversationId);
    if (existing) {
      const gid = groupOfTab(existing.id);
      if (gid) {
        setGroups((prev) => (prev[gid] ? { ...prev, [gid]: { ...prev[gid], activeId: existing.id } } : prev));
        setActiveGroupId(gid);
        return;
      }
    }
    const model = conversations.find((c) => c.id === conversationId)?.model ?? DEFAULT_MODEL;
    addTabToActiveGroup({ id: nextId("t"), repo, conversationId, model });
  };

  const newChatTab = (repo: string) => addTabToActiveGroup({ id: nextId("t"), repo, conversationId: null, model: DEFAULT_MODEL });

  // Open one seeded tab per spawn, inheriting the source tab's repo/model/profile.
  // Each fresh tab creates its own conversation on the seed's first send, and all
  // spawned tabs stay mounted so their streams run concurrently in the background.
  const onSpawnChats = (sourceTabId: string, spawns: ChatSpawn[]) => {
    const source = tabs[sourceTabId];
    if (!source) return;
    for (const spawn of spawns.slice(0, MAX_SPAWNS)) {
      addTabToActiveGroup({
        id: nextId("t"),
        repo: source.repo,
        conversationId: null,
        model: source.model,
        profile: source.profile,
        seedPrompt: spawn.prompt,
      });
    }
  };

  const selectTab = (groupId: string, tabId: string) => {
    setGroups((prev) => (prev[groupId] ? { ...prev, [groupId]: { ...prev[groupId], activeId: tabId } } : prev));
    setActiveGroupId(groupId);
  };

  const closeTab = (groupId: string, tabId: string) => {
    const group = groups[groupId];
    if (!group) return;
    const remaining = group.tabIds.filter((id) => id !== tabId);
    const nextGroups = { ...groups };
    if (remaining.length) nextGroups[groupId] = { ...group, tabIds: remaining, activeId: group.activeId === tabId ? remaining[remaining.length - 1] : group.activeId };
    else delete nextGroups[groupId];
    setGroups(nextGroups);
    if (!remaining.length) setLayout(removeFromLayout(layout, groupId));
    setTabs((prev) => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  };

  const deleteConversation = async (id: string) => {
    await api(`/api/chat/${id}`, { method: "DELETE" });
    const tab = Object.values(tabs).find((entry) => entry.conversationId === id);
    if (tab) {
      const gid = groupOfTab(tab.id);
      if (gid) closeTab(gid, tab.id);
    }
    await loadConversations();
  };

  // --- drag-to-split ---
  const handleDrop = (targetGroupId: string, dir: Dir) => {
    const current = drag;
    clearDrag();
    if (!current) return;

    // Resolve the tab being placed, creating one for a sidebar conversation.
    let tabId: string;
    let fromGroup: string | null;
    let newTab: Tab | null = null;
    if (current.kind === "tab") {
      tabId = current.tabId;
      fromGroup = current.fromGroup;
    } else {
      const existing = Object.values(tabs).find((tab) => tab.conversationId === current.conversationId);
      if (existing) {
        tabId = existing.id;
        fromGroup = groupOfTab(existing.id);
      } else {
        const model = conversations.find((c) => c.id === current.conversationId)?.model ?? DEFAULT_MODEL;
        newTab = { id: nextId("t"), repo: current.repo, conversationId: current.conversationId, model };
        tabId = newTab.id;
        fromGroup = null;
      }
    }

    if (dir === "center" && fromGroup === targetGroupId) return; // dropped back on itself

    const nextGroups = { ...groups };
    // Remove from source; drop the source group if it empties.
    if (fromGroup && nextGroups[fromGroup]) {
      const src = nextGroups[fromGroup];
      const remaining = src.tabIds.filter((id) => id !== tabId);
      if (remaining.length) nextGroups[fromGroup] = { ...src, tabIds: remaining, activeId: src.activeId === tabId ? remaining[remaining.length - 1] : src.activeId };
      else delete nextGroups[fromGroup];
    }

    let nextLayout = layout;
    let focusId = targetGroupId;
    if (dir === "center") {
      const target = nextGroups[targetGroupId];
      if (!target) return;
      nextGroups[targetGroupId] = { ...target, tabIds: target.tabIds.includes(tabId) ? target.tabIds : [...target.tabIds, tabId], activeId: tabId };
    } else {
      const group: Group = { id: nextId("g"), tabIds: [tabId], activeId: tabId };
      nextGroups[group.id] = group;
      focusId = group.id;
      const [lane, idx] = locate(layout, targetGroupId);
      if (dir === "left") nextLayout = insertAsNewLane(layout, group.id, lane);
      else if (dir === "right") nextLayout = insertAsNewLane(layout, group.id, lane + 1);
      else if (dir === "top") nextLayout = insertInLane(layout, group.id, lane, idx);
      else nextLayout = insertInLane(layout, group.id, lane, idx + 1);
    }
    if (fromGroup && !nextGroups[fromGroup]) nextLayout = removeFromLayout(nextLayout, fromGroup);

    if (newTab) setTabs((prev) => ({ ...prev, [newTab.id]: newTab }));
    setGroups(nextGroups);
    setLayout(nextLayout);
    setActiveGroupId(focusId);
  };

  // Drop onto an empty canvas: seed the first group.
  const handleEmptyDrop = () => {
    const current = drag;
    clearDrag();
    if (!current) return;
    let tab: Tab;
    if (current.kind === "tab") {
      const existing = tabs[current.tabId];
      if (!existing) return;
      tab = existing;
    } else {
      const existing = Object.values(tabs).find((entry) => entry.conversationId === current.conversationId);
      const model = conversations.find((c) => c.id === current.conversationId)?.model ?? DEFAULT_MODEL;
      tab = existing ?? { id: nextId("t"), repo: current.repo, conversationId: current.conversationId, model };
    }
    const group: Group = { id: nextId("g"), tabIds: [tab.id], activeId: tab.id };
    setTabs((prev) => ({ ...prev, [tab.id]: tab }));
    setGroups({ [group.id]: group });
    setLayout([[group.id]]);
    setActiveGroupId(group.id);
  };

  // --- resize ---
  const setGroupSize = (groupId: string, height: number) =>
    setGroupHeights((prev) => {
      const next = { ...prev, [groupId]: Math.max(160, height) };
      persist(HEIGHTS_KEY, next);
      return next;
    });
  const setLaneBasisFor = (sig: string, basis: number) =>
    setLaneBasis((prev) => {
      const next = { ...prev, [sig]: Math.max(260, basis) };
      persist(BASIS_KEY, next);
      return next;
    });

  // --- tree ---
  const conversationsByRepo = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const repo of repos) map.set(repo, []);
    for (const conversation of conversations) {
      const list = map.get(conversation.repo) ?? [];
      list.push(conversation);
      map.set(conversation.repo, list);
    }
    return map;
  }, [repos, conversations]);

  const toggleRepo = (repo: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });

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

  const tree = (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {repos.length === 0 && <div className="px-1.5 py-2 text-[0.6rem] text-muted-foreground">No repos mapped. Add `owner/repo=/local/path` lines in Settings → Agent automator.</div>}
      {repos.map((repo) => {
        const convos = conversationsByRepo.get(repo) ?? [];
        const isOpen = expanded.has(repo);
        return (
          <div key={repo}>
            <div className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/50">
              <button type="button" onClick={() => toggleRepo(repo)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                {isOpen ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                <FolderGit2 className="size-3 shrink-0" style={{ color: repoAccent(repo) }} />
                <span className="truncate text-xs font-medium">{repo}</span>
                <span className="shrink-0 text-[0.55rem] text-muted-foreground">{convos.length || ""}</span>
              </button>
              <button
                type="button"
                onClick={() => newChatTab(repo)}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                title={`New chat in ${repo}`}
              >
                <MessageSquarePlus className="size-3" />
              </button>
            </div>
            {isOpen && (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                {convos.length === 0 && <div className="px-1 py-1 text-[0.55rem] text-muted-foreground">No conversations yet.</div>}
                {convos.map((conversation) => (
                  <div
                    key={conversation.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copyMove";
                      event.dataTransfer.setData("text/plain", conversation.id);
                      setDrag({ kind: "conv", repo, conversationId: conversation.id });
                    }}
                    onDragEnd={clearDrag}
                    className={`group flex cursor-grab items-center gap-1 rounded px-1 py-1 active:cursor-grabbing ${openTabIds.has(conversation.id) ? "bg-accent/60" : "hover:bg-accent/50"}`}
                    title="Click to open as a tab · drag onto a pane to split"
                  >
                    <button type="button" onClick={() => openConversation(repo, conversation.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[0.7rem]">{conversation.title || "Untitled chat"}</div>
                      <div className="text-[0.55rem] text-muted-foreground">{conversation.message_count} msgs · {relativeTime(conversation.updated_at)} ago</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteConversation(conversation.id)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 gap-2">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 rounded-md border border-border p-1 md:flex">
        <div className="flex items-center gap-1 px-1 py-0.5">
          <span className="flex-1 text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">Repositories</span>
          {repos[0] && (
            <Button type="button" size="xs" variant="secondary" className="shrink-0" onClick={() => newChatTab(repos[0])} title="New chat">
              <Plus className="size-3" />
            </Button>
          )}
        </div>
        {tree}
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        {/* Mobile chat access — the repo/conversation sidebar is hidden on phones. */}
        <details className="group/mchats relative shrink-0 md:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
            <FolderGit2 className="size-3.5 text-muted-foreground" />
            <span className="font-semibold">Chats &amp; repos</span>
            {repos[0] && (
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="ml-auto"
                onClick={(event) => {
                  event.preventDefault();
                  newChatTab(repos[0]);
                }}
              >
                <Plus className="size-3" /> New
              </Button>
            )}
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open/mchats:rotate-180" />
          </summary>
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md">{tree}</div>
        </details>
        {error && <div className="shrink-0 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}
        {layout.length === 0 ? (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleEmptyDrop}
            className={`m-auto max-w-sm rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground ${dragging ? "border-[var(--ctp-blue)] bg-[var(--ctp-blue)]/10" : "border-border"}`}
          >
            No open chats. Pick a conversation from the tree, drag one here, or start a new chat.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-1 md:flex-row md:overflow-x-auto md:overflow-y-hidden" onDragEnd={clearDrag}>
            {layout.map((lane, laneIndex, lanesArr) => {
              const sig = lane.join(",");
              // Desktop: side-by-side resizable columns. Mobile: full-width lanes
              // stacked vertically with a tall min-height, scrolling down the page.
              const laneStyle: React.CSSProperties = isDesktop
                ? { flex: `1 1 ${laneBasis[sig] ?? DEFAULT_BASIS}px`, minWidth: 260 }
                : { minHeight: "78vh" };
              return (
                <Fragment key={sig || laneIndex}>
                  <div className="flex min-w-0 flex-col gap-1 md:h-full" style={laneStyle}>
                    {lane.map((groupId, groupIndex) => {
                      const group = groups[groupId];
                      if (!group) return null;
                      const isLast = groupIndex === lane.length - 1;
                      const explicitH = groupHeights[groupId];
                      const wrapperStyle = !isLast && explicitH ? { height: explicitH, flexShrink: 0 } : { flex: "1 1 0", minHeight: 0 };
                      return (
                        <Fragment key={groupId}>
                          <div className="flex min-h-0 flex-col" style={wrapperStyle}>
                            <GroupPane
                              group={group}
                              tabs={tabs}
                              conversations={conversations}
                              models={models}
                              profiles={profiles}
                              dragging={dragging}
                              active={activeGroupId === groupId}
                              onActivate={() => setActiveGroupId(groupId)}
                              onSelectTab={(tabId) => selectTab(groupId, tabId)}
                              onCloseTab={(tabId) => closeTab(groupId, tabId)}
                              onNewTab={() => {
                                const repo = tabs[group.activeId ?? ""]?.repo ?? repos[0];
                                if (repo) newChatTab(repo);
                              }}
                              onTabDragStart={(event, tabId) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", tabId);
                                setDrag({ kind: "tab", tabId, fromGroup: groupId });
                              }}
                              onSplitDrop={(dir) => handleDrop(groupId, dir)}
                              onModelChange={(tabId, model) => patchTab(tabId, { model })}
                              onProfileChange={(tabId, profile) => patchTab(tabId, { profile })}
                              onConversationCreated={(tabId, convId) => {
                                patchTab(tabId, { conversationId: convId });
                                void loadConversations();
                              }}
                              onActivity={loadConversations}
                              onSpawnChats={onSpawnChats}
                              onSeedConsumed={(tabId) => patchTab(tabId, { seedPrompt: undefined })}
                            />
                          </div>
                          {!dragging && !isLast && isDesktop && <ResizeHandle axis="y" onResize={(value) => setGroupSize(groupId, value)} />}
                        </Fragment>
                      );
                    })}
                  </div>
                  {!dragging && isDesktop && laneIndex < lanesArr.length - 1 && (
                    <ResizeHandle axis="x" getStart={() => laneBasis[sig] ?? DEFAULT_BASIS} onResize={(value) => setLaneBasisFor(sig, value)} />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// A tabbed pane (editor group): a tab bar over the active tab's chat. All tabs
// stay mounted (hidden when inactive) so a streaming reply survives tab switches.
function GroupPane({
  group,
  tabs,
  conversations,
  models,
  profiles,
  dragging,
  active,
  onActivate,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onTabDragStart,
  onSplitDrop,
  onModelChange,
  onProfileChange,
  onConversationCreated,
  onActivity,
  onSpawnChats,
  onSeedConsumed,
}: {
  group: Group;
  tabs: Record<string, Tab>;
  conversations: Conversation[];
  models: Model[];
  profiles: string[];
  dragging: boolean;
  active: boolean;
  onActivate: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onTabDragStart: (event: React.DragEvent, tabId: string) => void;
  onSplitDrop: (dir: Dir) => void;
  onModelChange: (tabId: string, model: string) => void;
  onProfileChange: (tabId: string, profile: string) => void;
  onConversationCreated: (tabId: string, id: string) => void;
  onActivity: () => void;
  onSpawnChats: (tabId: string, spawns: ChatSpawn[]) => void;
  onSeedConsumed: (tabId: string) => void;
}) {
  const titleOf = (tab: Tab) => (tab.conversationId ? conversations.find((c) => c.id === tab.conversationId)?.title || "Untitled chat" : "New chat");
  return (
    <div
      onMouseDown={onActivate}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-[var(--ctp-mantle)]/40 ${active ? "border-[var(--ctp-blue)]/60" : "border-border"}`}
    >
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-1 py-0.5">
        {group.tabIds.map((tabId) => {
          const tab = tabs[tabId];
          if (!tab) return null;
          const isActive = group.activeId === tabId;
          return (
            <div
              key={tabId}
              draggable
              onDragStart={(event) => onTabDragStart(event, tabId)}
              onClick={() => onSelectTab(tabId)}
              title={`${tab.repo} · ${titleOf(tab)}`}
              className={`group/tab flex shrink-0 cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] active:cursor-grabbing ${isActive ? "bg-[var(--ctp-surface0)]" : "hover:bg-[var(--ctp-surface0)]/50"}`}
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: repoAccent(tab.repo) }} />
              <span className="max-w-[9rem] truncate">{titleOf(tab)}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tabId);
                }}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/tab:opacity-100"
                aria-label="Close tab"
              >
                <X className="size-2.5" />
              </button>
            </div>
          );
        })}
        <button type="button" onClick={onNewTab} className="shrink-0 px-1 text-muted-foreground hover:text-foreground" title="New chat in this group">
          <Plus className="size-3" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {group.tabIds.map((tabId) => {
          const tab = tabs[tabId];
          if (!tab) return null;
          const isActive = group.activeId === tabId;
          return (
            <div key={tabId} className={`absolute inset-0 p-1.5 ${isActive ? "" : "hidden"}`}>
              <ChatWindow
                repo={tab.repo}
                conversationId={tab.conversationId}
                model={tab.model}
                models={models}
                onModelChange={(model) => onModelChange(tabId, model)}
                profile={tab.profile ?? ""}
                profiles={profiles}
                onProfileChange={(profile) => onProfileChange(tabId, profile)}
                onConversationCreated={(id) => onConversationCreated(tabId, id)}
                onActivity={onActivity}
                onSpawnChats={(spawns) => onSpawnChats(tabId, spawns)}
                seedPrompt={tab.seedPrompt}
                onSeedConsumed={() => onSeedConsumed(tabId)}
              />
            </div>
          );
        })}
      </div>

      {dragging && <SplitOverlay onDrop={onSplitDrop} />}
    </div>
  );
}

// While a drag is in flight, covers a pane and shows the split preview for the
// region under the pointer (center = drop as a tab; edges = split that way).
function SplitOverlay({ onDrop }: { onDrop: (dir: Dir) => void }) {
  const [region, setRegion] = useState<Dir | null>(null);
  return (
    <div
      className="absolute inset-0 z-20"
      onDragOver={(event) => {
        event.preventDefault();
        setRegion(regionFromEvent(event));
      }}
      onDragLeave={() => setRegion(null)}
      onDrop={(event) => {
        event.preventDefault();
        const dir = regionFromEvent(event);
        setRegion(null);
        onDrop(dir);
      }}
    >
      {region && (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-[var(--ctp-blue)] bg-[var(--ctp-blue)]/25 transition-all duration-75"
          style={regionStyle(region)}
        />
      )}
    </div>
  );
}
