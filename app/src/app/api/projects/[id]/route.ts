import { ok, serverError } from "@/lib/json";
import { deleteProject } from "@/server/projects";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteProject(id);
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
