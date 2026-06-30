import { ok, serverError } from "@/lib/json";
import { listActivityThreads } from "@/server/activity";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const value = (key: string) => params.get(key) || undefined;
    return ok(
      await listActivityThreads({
        repository: value("repository"),
        kind: value("kind"),
        actor: value("actor"),
        projectId: value("projectId"),
        search: value("search"),
        unreadOnly: params.get("unreadOnly") === "true",
        includeDone: params.get("includeDone") === "true",
      }),
    );
  } catch (error) {
    return serverError(error);
  }
}
