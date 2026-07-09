-- Persisted read-only repo chats. Conversations are a Githubers-side display
-- convenience (not authoritative run state); each holds an ordered message log.
-- The daemon stays stateless — Githubers replays the history on each turn.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo text NOT NULL,                 -- "owner/repo" (maps to a local clone path in settings)
  model text,                         -- opencode model id; null = profile default
  title text,                         -- derived from the first user message
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_conversations_repo_idx ON chat_conversations(repo, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,                 -- 'user' | 'assistant'
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages(conversation_id, created_at);
