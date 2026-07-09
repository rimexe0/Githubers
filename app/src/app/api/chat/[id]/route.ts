import { jsonError, ok, serverError } from "@/lib/json";
import { deleteConversation, getConversation } from "@/server/chat";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const data = await getConversation(id);
    if (!data) return jsonError("Conversation not found", 404);
    return ok(data);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteConversation(id);
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
