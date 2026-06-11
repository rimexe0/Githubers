import { badRequest, ok, serverError } from "@/lib/json";
import { settingsSchema } from "@/lib/schemas";
import { getSettings, saveSettings } from "@/server/settings";

export async function GET() {
  try {
    return ok(await getSettings());
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Invalid settings", parsed.error.flatten());
    return ok(await saveSettings(parsed.data));
  } catch (error) {
    return serverError(error);
  }
}
