import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getImportStatus, startImport } from "@/server/automator";

// GET: current import job status + stats (poll this to drive the wizard's live
// progress). POST: start the mine → review → synthesize job; the daemon returns
// 409 if one is already active, which we surface verbatim.
export async function GET() {
  try {
    const config = await getAutomatorConfig();
    return ok(await getImportStatus(config));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}

export async function POST() {
  try {
    const config = await getAutomatorConfig();
    return ok(await startImport(config));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
