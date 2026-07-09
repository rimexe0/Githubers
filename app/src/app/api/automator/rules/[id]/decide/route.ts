import { jsonError, ok } from "@/lib/json";
import { automatorErrorInfo, decideRule, getAutomatorConfig, type RuleDecision } from "@/server/automator";

// Approve / edit-then-approve / reject a pending rule. The daemon owns rule
// storage — an approval moves the rule pending → active in the store, it does
// not edit AGENTS.md directly.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<RuleDecision>;
    const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
    if (!status) return jsonError("status must be 'approved' or 'rejected'", 400);
    const decision: RuleDecision = { status };
    if (typeof body.editedText === "string" && body.editedText.trim()) decision.editedText = body.editedText;
    const config = await getAutomatorConfig();
    return ok(await decideRule(config, id, decision));
  } catch (error) {
    const { message, status } = automatorErrorInfo(error);
    return jsonError(message, status);
  }
}
