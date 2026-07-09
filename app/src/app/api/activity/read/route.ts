import { ok, serverError } from "@/lib/json";
import { markAllThreadsRead, markThreadRead } from "@/server/activity";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { contentId?: string; all?: boolean };
    if (body.all || !body.contentId) {
      await markAllThreadsRead();
    } else {
      await markThreadRead(body.contentId);
    }
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
