import { badRequest, ok, serverError } from "@/lib/json";
import { projectSchema } from "@/lib/schemas";
import { deleteProject, updateProject } from "@/server/projects";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = projectSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Invalid project", parsed.error.flatten());
    await updateProject(id, parsed.data);
    return ok({ id });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteProject(id);
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
