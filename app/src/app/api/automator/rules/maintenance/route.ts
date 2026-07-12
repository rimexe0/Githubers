import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getRuleMaintenance } from "@/server/automator";
export async function GET() { try { return ok(await getRuleMaintenance(await getAutomatorConfig())); } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); } }
