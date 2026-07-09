import { ok, serverError } from "@/lib/json";
import { autoSync } from "@/server/sync";

export async function POST() {
  try {
    return ok(await autoSync());
  } catch (error) {
    return serverError(error);
  }
}
