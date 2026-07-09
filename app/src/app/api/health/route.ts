import { ok, serverError } from "@/lib/json";
import { checkDatabase } from "@/server/health";

export async function GET() {
  try {
    return ok({ database: await checkDatabase(), status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
