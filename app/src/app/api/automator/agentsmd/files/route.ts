import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAgentsmdFiles, getAutomatorConfig } from "@/server/automator";

// Auto-load AGENTS.md/CLAUDE.md for the given mapped repo (owner/repo) plus the
// user's global locations, so the panel doesn't require a manual paste. Files
// are read on the daemon host (local to them) and relayed, never stored here.
export async function GET(request: Request) {
  try {
    const config = await getAutomatorConfig();
    const repo = new URL(request.url).searchParams.get("repo") ?? undefined;
    return ok(await getAgentsmdFiles(config, repo));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
