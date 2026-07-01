import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, chatWithRepo, getAutomatorConfig, type ChatMessage } from "@/server/automator";

// Repos available to chat = those with a local-path mapping (the daemon runs the
// read-only agent in that directory). Also reports whether the integration is on.
export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok({ enabled: config.enabled, repos: Array.from(config.repoPaths.keys()) });
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const config = await getAutomatorConfig();
    const body = (await request.json()) as { repo?: string; messages?: ChatMessage[] };
    const repo = typeof body.repo === "string" ? body.repo : "";
    const repoPath = config.repoPaths.get(repo);
    if (!repoPath) return jsonError(`No local path mapped for ${repo || "(no repo)"}. Add it in Settings → Agent automator.`, 400);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return jsonError("No messages provided", 400);
    return ok(await chatWithRepo(config, { repoPath, messages }));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
