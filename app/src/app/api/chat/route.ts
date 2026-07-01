import { badRequest, ok, serverError } from "@/lib/json";
import { createConversation, listConversations } from "@/server/chat";

export async function GET(request: Request) {
  try {
    const repo = new URL(request.url).searchParams.get("repo") ?? undefined;
    return ok(await listConversations(repo));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { repo?: string; model?: string };
    if (!body.repo) return badRequest("repo is required");
    return ok(await createConversation(body.repo, body.model ?? null));
  } catch (error) {
    return serverError(error);
  }
}
