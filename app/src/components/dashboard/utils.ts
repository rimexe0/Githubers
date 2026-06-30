import type { Project } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function projectLabel(project: Project) {
  return project.title || `${project.owner_login} #${project.project_number}`;
}

export function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const staticTabs = ["summaries", "settings"];

export function stateClass(state: string | null) {
  if (state === "OPEN") return "state-open";
  if (state === "MERGED") return "state-merged";
  if (state === "CLOSED") return "state-closed";
  return "state-draft";
}

export function columnAccent(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("done") || n.includes("complete") || n.includes("closed")) return "var(--ctp-green)";
  if (n.includes("review")) return "var(--ctp-mauve)";
  if (n.includes("progress") || n.includes("doing") || n.includes("active")) return "var(--ctp-yellow)";
  if (n.includes("ready")) return "var(--ctp-blue)";
  if (n.includes("block")) return "var(--ctp-red)";
  if (n.includes("backlog") || n.includes("todo") || n.includes("to do") || n.includes("triage")) return "var(--ctp-overlay1)";
  return "var(--ctp-lavender)";
}

export function parseRepos(repos: string) {
  return repos.split("\n").flatMap((line) => {
    const repo = line.trim();
    if (!repo) return [];
    const [repoOwner, repoName] = repo.split("/");
    return repoOwner && repoName ? [{ ownerLogin: repoOwner, repoName }] : [];
  });
}
