import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getRun } from "@/server/automator";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const config = await getAutomatorConfig();
    return ok(await getRun(config, id));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
