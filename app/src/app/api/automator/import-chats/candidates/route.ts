import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, getImportCandidates } from "@/server/automator";

// The receipts / frustration browser. Filters (project, signal, source) pass
// straight through to the daemon. Privacy: we relay the verbatim messages to the
// browser and never persist or log them here.
export async function GET(request: Request) {
  try {
    const config = await getAutomatorConfig();
    const url = new URL(request.url);
    const candidates = await getImportCandidates(config, {
      project: url.searchParams.get("project") ?? undefined,
      signal: url.searchParams.get("signal") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
    });
    return ok(candidates);
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
