-- Chat can target different agent backends (opencode-plan | claude | codex | …),
-- not just an OpenCode model. Persist the chosen daemon profile per conversation.
ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS profile text;
