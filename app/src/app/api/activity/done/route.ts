import { badRequest, ok, serverError } from "@/lib/json";
import { setThreadDone } from "@/server/activity";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { contentId?: string; done?: boolean };
    if (!body.contentId) return badRequest("contentId is required");
    await setThreadDone(body.contentId, body.done ?? true);
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
