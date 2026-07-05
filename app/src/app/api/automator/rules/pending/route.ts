import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getPendingRules } from "@/server/automator";

// The pending-queue rules (shared with #4). The migration wizard's Review & merge
// step reads the import-sourced entries from here.
export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok(await getPendingRules(config));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
