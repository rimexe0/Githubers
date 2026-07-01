import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, isRunAction, runAction } from "@/server/automator";

// Lifecycle + supervised actions: start | pause | resume | stop | kill |
// approve | open-pr. Static sibling segments (steps, artifacts) take priority
// over this dynamic segment in the App Router.
export async function POST(_request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await context.params;
    if (!isRunAction(action)) return jsonError(`Unknown run action: ${action}`, 400);
    const config = await getAutomatorConfig();
    return ok(await runAction(config, id, action));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
