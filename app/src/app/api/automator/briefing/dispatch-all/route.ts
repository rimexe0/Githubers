import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, briefingDispatchAll, getAutomatorConfig } from "@/server/automator";

export async function POST() {
  try { return ok(await briefingDispatchAll(await getAutomatorConfig())); }
  catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
