import { badRequest, jsonError, serverError } from "@/lib/json";
import { automatorErrorInfo, getAutomatorConfig, openChatStream } from "@/server/automator";
import { appendMessage, getConversation, touchConversation, type ThinkingEvent } from "@/server/chat";

// Streaming send: persist the user turn, open the daemon's NDJSON stream, relay
// it to the browser verbatim, and (by watching for the final `done` event)
// persist the assistant reply once complete. `thinking` is transient — streamed
// to the UI but not stored.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { content?: string; model?: string; profile?: string };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return badRequest("content is required");

    const existing = await getConversation(id);
    if (!existing) return jsonError("Conversation not found", 404);

    const config = await getAutomatorConfig();
    const repoPath = config.repoPaths.get(existing.conversation.repo);
    if (!repoPath) {
      return jsonError(`No local path mapped for ${existing.conversation.repo}. Add it in Settings → Agent automator.`, 400);
    }

    const model = body.model ?? existing.conversation.model ?? undefined;
    const profile = body.profile ?? existing.conversation.profile ?? undefined;
    const isFirstTurn = existing.messages.length === 0;
    await appendMessage(id, "user", content);
    const history = [...existing.messages.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content }];

    let daemonResponse: Response;
    try {
      daemonResponse = await openChatStream(config, { repoPath, messages: history, model, profile });
    } catch (error) {
      const { message, status } = automatorErrorInfo(error);
      await touchConversation(id, model ?? null, isFirstTurn ? content : null, profile ?? null);
      return jsonError(message, status);
    }

    const upstream = daemonResponse.body;
    if (!upstream) {
      await touchConversation(id, model ?? null, isFirstTurn ? content : null, profile ?? null);
      return jsonError("No stream from automator daemon", 502);
    }

    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalReply = "";
    let finalThinking: ThinkingEvent[] = [];

    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          if (finalReply.trim()) await appendMessage(id, "assistant", finalReply, finalThinking);
          await touchConversation(id, model ?? null, isFirstTurn ? content : null, profile ?? null);
          controller.close();
          return;
        }
        controller.enqueue(value); // forward raw NDJSON to the browser
        // Sniff the `done` event so we know what to persist.
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type?: string; reply?: string; thinking?: ThinkingEvent[] };
            if (event.type === "done" && typeof event.reply === "string") finalReply = event.reply;
            if (event.type === "done" && Array.isArray(event.thinking)) finalThinking = event.thinking;
          } catch {
            /* partial/non-JSON — ignore */
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" },
    });
  } catch (error) {
    return serverError(error);
  }
}
