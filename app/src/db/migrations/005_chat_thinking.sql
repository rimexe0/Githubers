-- Persist the assistant's thinking trace (reasoning + tool-read events) so it
-- survives a reload, instead of vanishing once the stream ends.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thinking jsonb NOT NULL DEFAULT '[]'::jsonb;
