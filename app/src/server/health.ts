import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "@/db/client";
import { fetchProjectState } from "@/server/github";
import { listProjects } from "@/server/projects";
import { getSettings } from "@/server/settings";

function formatGraphQlErrors(errors: { message: string }[]) {
  const message = errors.map((error) => error.message).join("; ");
  if (message.includes("Resource not accessible by personal access token")) {
    return `${message}. GitHub Projects v2 requires a classic PAT with repo + read:project; fine-grained PATs cannot read Projects v2.`;
  }
  return message;
}

export async function checkDatabase() {
  const result = await query<{ ok: number }>("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}

export async function checkLmStudio() {
  const settings = await getSettings();
  const response = await fetch(`${settings.lmStudioBaseUrl.replace(/\/$/, "")}/models`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`LM Studio failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function checkGitHub() {
  const settings = await getSettings();
  if (!settings.githubToken) throw new Error("GitHub token is not configured");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.githubToken}`,
      "content-type": "application/json",
      "user-agent": "github-project-change-watcher",
    },
    body: JSON.stringify({ query: "query { viewer { login } rateLimit { remaining resetAt } }" }),
  });
  if (!response.ok) throw new Error(`GitHub failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(formatGraphQlErrors(payload.errors));

  const projects = await listProjects();
  const firstEnabledProject = projects.find((project) => project.enabled);
  if (!firstEnabledProject) return { ...payload.data, projectAccess: "not_checked_no_projects_configured" };

  const projectState = await fetchProjectState(firstEnabledProject, settings.githubToken, 1);
  return {
    ...payload.data,
    projectAccess: {
      owner: firstEnabledProject.owner_login,
      number: firstEnabledProject.project_number,
      title: projectState.title,
    },
  };
}

export function verifyGitHubSignature(secret: string, body: string, signature: string | null) {
  if (!secret) throw new Error("Webhook secret is not configured");
  if (!signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}
