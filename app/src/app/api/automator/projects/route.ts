import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, listAutomatorProjects, saveAutomatorProject, type AutomatorProject } from "@/server/automator";

export async function GET() {
  try { return ok(await listAutomatorProjects(await getAutomatorConfig())); }
  catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}

export async function POST(request: Request) {
  try { return ok(await saveAutomatorProject(await getAutomatorConfig(), await request.json() as AutomatorProject)); }
  catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
