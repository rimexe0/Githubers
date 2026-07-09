import { jsonError } from "@/lib/json";
import { automatorErrorInfo, getArtifact, getAutomatorConfig } from "@/server/automator";

// Returns the raw artifact (diff.txt, pr-message.md, ...) as plain text so the
// review UI can render it directly.
export async function GET(_request: Request, context: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await context.params;
    const config = await getAutomatorConfig();
    const content = await getArtifact(config, id, name);
    return new Response(content, { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
