import { query } from "@/db/client";

export type ChatRole = "user" | "assistant";

export type ThinkingEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; tool: string; label: string; status: string };

export type ChatMessageRow = {
  id: string;
  role: ChatRole;
  content: string;
  thinking: ThinkingEvent[];
  created_at: string;
};

export type ChatConversationRow = {
  id: string;
  repo: string;
  model: string | null;
  profile: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export async function listConversations(repo?: string): Promise<(ChatConversationRow & { message_count: number })[]> {
  const result = await query<ChatConversationRow & { message_count: number }>(
    `SELECT c.id, c.repo, c.model, c.profile, c.title, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
     FROM chat_conversations c
     ${repo ? "WHERE c.repo = $1" : ""}
     ORDER BY c.updated_at DESC
     LIMIT 100`,
    repo ? [repo] : [],
  );
  return result.rows;
}

export async function createConversation(repo: string, model: string | null, profile: string | null = null): Promise<ChatConversationRow> {
  const result = await query<ChatConversationRow>(
    "INSERT INTO chat_conversations (repo, model, profile) VALUES ($1, $2, $3) RETURNING id, repo, model, profile, title, created_at, updated_at",
    [repo, model, profile],
  );
  return result.rows[0];
}

export async function getConversation(id: string): Promise<{ conversation: ChatConversationRow; messages: ChatMessageRow[] } | null> {
  const conversation = await query<ChatConversationRow>(
    "SELECT id, repo, model, profile, title, created_at, updated_at FROM chat_conversations WHERE id = $1",
    [id],
  );
  if (conversation.rowCount === 0) return null;

  const messages = await query<ChatMessageRow>(
    "SELECT id, role, content, thinking, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [id],
  );
  return { conversation: conversation.rows[0], messages: messages.rows };
}

export async function deleteConversation(id: string): Promise<void> {
  await query("DELETE FROM chat_conversations WHERE id = $1", [id]);
}

export async function appendMessage(
  conversationId: string,
  role: ChatRole,
  content: string,
  thinking?: ThinkingEvent[],
): Promise<ChatMessageRow> {
  const result = await query<ChatMessageRow>(
    "INSERT INTO chat_messages (conversation_id, role, content, thinking) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, role, content, thinking, created_at",
    [conversationId, role, content, JSON.stringify(thinking ?? [])],
  );
  return result.rows[0];
}

// Bump updated_at, adopt model/profile changes, and set the title from the first
// user message if it hasn't been set yet.
export async function touchConversation(
  id: string,
  model: string | null,
  titleCandidate: string | null,
  profile: string | null = null,
): Promise<void> {
  const title = titleCandidate ? titleCandidate.slice(0, 80) : null;
  await query(
    `UPDATE chat_conversations
     SET updated_at = now(),
         model = COALESCE($2, model),
         profile = COALESCE($4, profile),
         title = COALESCE(title, $3)
     WHERE id = $1`,
    [id, model, title, profile],
  );
}
