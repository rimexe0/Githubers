import { ok, serverError } from "@/lib/json";
import { runSync } from "@/server/sync";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await runSync("manual", id));
  } catch (error) {
    return serverError(error);
  }
}
