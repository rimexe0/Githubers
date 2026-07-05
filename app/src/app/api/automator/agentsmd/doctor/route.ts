import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, runDoctor } from "@/server/automator";

// Audit an AGENTS.md body: POST { content } → { score, findings[] }. Findings are
// consumable as pending-queue items (quote → problem → suggested rewrite).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { content?: unknown; profile?: unknown };
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) return jsonError("No AGENTS.md content provided", 400);
    const profile = typeof body.profile === "string" ? body.profile : undefined;
    const config = await getAutomatorConfig();
    return ok(await runDoctor(config, content, profile));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
