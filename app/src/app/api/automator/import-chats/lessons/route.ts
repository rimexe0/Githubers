import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getImportLessons } from "@/server/automator";

// Synthesized lessons (rule + scope + category) linked to the candidate that
// earned each one, so the receipts browser can show "what was learned".
export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok(await getImportLessons(config));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
