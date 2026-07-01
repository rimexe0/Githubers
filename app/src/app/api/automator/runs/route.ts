import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, listRuns } from "@/server/automator";

export async function GET(request: Request) {
  try {
    const config = await getAutomatorConfig();
    const url = new URL(request.url);
    const runs = await listRuns(config, {
      state: url.searchParams.get("state") ?? undefined,
      repo: url.searchParams.get("repo") ?? undefined,
    });
    return ok(runs);
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
