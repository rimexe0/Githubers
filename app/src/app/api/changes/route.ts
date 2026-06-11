import { ok, serverError } from "@/lib/json";
import { listChanges } from "@/server/sync";

export async function GET() {
  try {
    return ok(await listChanges());
  } catch (error) {
    return serverError(error);
  }
}
