import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, listRuns } from "@/server/automator";

// Connectivity check for the Settings "Test daemon" button: hits GET /runs so a
// bad token (401) or unreachable host surfaces with the daemon's own message.
export async function POST() {
  try {
    const config = await getAutomatorConfig();
    if (!config.enabled) return jsonError("AgentAutomator integration is disabled", 503);
    const runs = await listRuns(config);
    return ok({ ok: true, runCount: runs.length });
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
