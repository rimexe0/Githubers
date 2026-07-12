import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, captureRule, getAutomatorConfig } from "@/server/automator";
export async function POST(request: Request) { try { const body = await request.json() as Record<string, unknown>; if (typeof body.situation !== "string" || !body.situation.trim()) return jsonError("situation is required", 400); return ok(await captureRule(await getAutomatorConfig(), body)); } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); } }
