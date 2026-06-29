import { ok, serverError } from "@/lib/json";
import { checkGitHub } from "@/server/health";

export async function POST() {
  try {
    return ok(await checkGitHub());
  } catch (error) {
    return serverError(error);
  }
}
