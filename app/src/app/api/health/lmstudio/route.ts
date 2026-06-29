import { ok, serverError } from "@/lib/json";
import { checkLmStudio } from "@/server/health";

export async function POST() {
  try {
    return ok(await checkLmStudio());
  } catch (error) {
    return serverError(error);
  }
}
