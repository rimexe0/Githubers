import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, reviewPullRequest } from "@/server/automator";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { repo?: unknown; number?: unknown; repoPath?: unknown; profile?: unknown };
    if (typeof body.repo !== "string" || !Number.isSafeInteger(body.number)) return jsonError("repo and positive number are required", 400);
    return ok(await reviewPullRequest(await getAutomatorConfig(), { repo: body.repo, number: Number(body.number), repoPath: typeof body.repoPath === "string" ? body.repoPath : undefined, profile: typeof body.profile === "string" ? body.profile : undefined }));
  } catch (error) { const info = automatorErrorInfo(error); return jsonError(info.message, info.status); }
}
