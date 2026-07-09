import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getDaemonConfig } from "@/server/automator";

// Daemon profile list + import defaults, used to populate the migrate wizard's
// reviewer/synthesizer model selectors and the doctor profile picker.
export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok(await getDaemonConfig(config));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
