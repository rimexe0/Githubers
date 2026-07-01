import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, listModels } from "@/server/automator";

export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok({ models: await listModels(config) });
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
