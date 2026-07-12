import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getRepeatedRules } from "@/server/automator";
export async function GET() { try { return ok(await getRepeatedRules(await getAutomatorConfig())); } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); } }
