import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, rollbackRules } from "@/server/automator";
export async function POST(request: Request) { try { const body = await request.json() as { ref?: unknown }; if (typeof body.ref !== "string" || !/^[a-f\d]{7,40}$/i.test(body.ref)) return jsonError("valid commit ref is required", 400); return ok(await rollbackRules(await getAutomatorConfig(), body.ref)); } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); } }
