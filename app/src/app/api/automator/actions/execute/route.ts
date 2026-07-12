import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, executeRemoteAction, getAutomatorConfig } from "@/server/automator";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) return jsonError("token is required", 400);
    return ok(await executeRemoteAction(await getAutomatorConfig(), body.token));
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
