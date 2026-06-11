import { badRequest, ok, serverError } from "@/lib/json";
import { projectSchema } from "@/lib/schemas";
import { createProject, listProjects } from "@/server/projects";

export async function GET() {
  try {
    return ok(await listProjects());
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = projectSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Invalid project", parsed.error.flatten());
    const id = await createProject(parsed.data);
    return ok({ id });
  } catch (error) {
    return serverError(error);
  }
}
