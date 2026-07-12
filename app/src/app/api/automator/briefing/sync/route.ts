import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, briefingSync, getAutomatorConfig } from "@/server/automator";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { repo?: unknown };
    if (typeof body.repo !== "string" || !body.repo.trim()) return jsonError("repo is required", 400);
    return ok(await briefingSync(await getAutomatorConfig(), body.repo));
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
