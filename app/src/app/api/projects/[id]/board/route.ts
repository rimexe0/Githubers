import { ok, serverError } from "@/lib/json";
import { getProjectBoard } from "@/server/board";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await getProjectBoard(id));
  } catch (error) {
    return serverError(error);
  }
}
