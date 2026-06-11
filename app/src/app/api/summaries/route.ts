import { ok, serverError } from "@/lib/json";
import { listSummaries, runSummary } from "@/server/summarizers";

export async function GET() {
  try {
    return ok(await listSummaries());
  } catch (error) {
    return serverError(error);
  }
}

export async function POST() {
  try {
    return ok(await runSummary("manual"));
  } catch (error) {
    return serverError(error);
  }
}
