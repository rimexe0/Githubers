import { ok, serverError } from "@/lib/json";
import { listSyncRuns, runSync } from "@/server/sync";

export async function GET() {
  try {
    return ok(await listSyncRuns());
  } catch (error) {
    return serverError(error);
  }
}

export async function POST() {
  try {
    return ok(await runSync("manual"));
  } catch (error) {
    return serverError(error);
  }
}
