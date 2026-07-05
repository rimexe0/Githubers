import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getImportStatus, type ImportParams, startImport } from "@/server/automator";

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

export async function POST(request: Request) {
  try {
    // Optional reviewer/synthesizer profile overrides from the wizard's model
    // selectors; empty body falls back to the daemon's import defaults.
    let params: ImportParams = {};
    try {
      const body = (await request.json()) as ImportParams;
      if (body && typeof body === "object") {
        params = {
          reviewerProfile: typeof body.reviewerProfile === "string" ? body.reviewerProfile : undefined,
          synthesizerProfile: typeof body.synthesizerProfile === "string" ? body.synthesizerProfile : undefined,
          maxCandidates: typeof body.maxCandidates === "number" ? body.maxCandidates : undefined,
        };
      }
    } catch {
      /* no body */
    }
    const config = await getAutomatorConfig();
    return ok(await startImport(config, params));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
