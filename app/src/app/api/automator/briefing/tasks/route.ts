import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, listBriefingTasks } from "@/server/automator";

export async function GET(request: Request) {
  try { return ok(await listBriefingTasks(await getAutomatorConfig(), new URL(request.url).searchParams.get("state") ?? undefined)); }
  catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
