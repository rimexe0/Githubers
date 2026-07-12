import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, briefingTaskAction, getAutomatorConfig } from "@/server/automator";

const ACTIONS = new Set(["context", "annotate", "dispatch", "state"] as const);
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await context.params;
    if (!ACTIONS.has(action as "context")) return jsonError("Unknown briefing action", 400);
    const body = action === "state" ? await request.json() : undefined;
    return ok(await briefingTaskAction(await getAutomatorConfig(), id, action as "context" | "annotate" | "dispatch" | "state", body));
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
