import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, previewRemoteAction, type RemoteAction } from "@/server/automator";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: RemoteAction };
    if (!body.action) return jsonError("action is required", 400);
    return ok(await previewRemoteAction(await getAutomatorConfig(), body.action));
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
