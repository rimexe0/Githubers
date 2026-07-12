import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, consolidateRules, getAutomatorConfig } from "@/server/automator";
export async function POST() { try { return ok(await consolidateRules(await getAutomatorConfig())); } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); } }
