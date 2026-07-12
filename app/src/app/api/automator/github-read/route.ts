import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, fetchAutomatorOpenIssues, getAutomatorConfig } from "@/server/automator";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { repo?: unknown };
    if (typeof body.repo !== "string" || !/^[^/]+\/[^/]+$/.test(body.repo)) return jsonError("repo must use owner/name format", 400);
    const [ownerLogin, repoName] = body.repo.split("/") as [string, string];
    const rows = await fetchAutomatorOpenIssues(await getAutomatorConfig(), [{ ownerLogin, repoName }]);
    return ok(rows[0]?.issues ?? []);
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
