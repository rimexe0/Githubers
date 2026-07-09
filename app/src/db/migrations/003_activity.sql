-- Activity overhaul: a normalized event taxonomy on top of the raw `changes`
-- feed, per-subject read/done state for the inbox, and a place to store PR
-- reviews captured during polling.

-- Normalized event fields. `change_type` stays as the raw discriminator;
-- these are the derived, human-meaningful classification the UI renders.
ALTER TABLE changes ADD COLUMN IF NOT EXISTS event_kind text;       -- pr | issue | review | comment | project | other
ALTER TABLE changes ADD COLUMN IF NOT EXISTS event_verb text;       -- opened | merged | review_approved | ...
ALTER TABLE changes ADD COLUMN IF NOT EXISTS subject_number integer;
ALTER TABLE changes ADD COLUMN IF NOT EXISTS linked_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS changes_kind_time_idx ON changes(event_kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS changes_content_time_idx ON changes(content_id, occurred_at DESC);

-- Inbox state is tracked per subject (issue/PR/item = content_id), not per
-- event row: marking a thread read clears every event under it.
CREATE TABLE IF NOT EXISTS thread_reads (
  content_id text PRIMARY KEY,
  last_read_at timestamptz,
  done boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PR reviews surfaced by polling. The webhook path emits review change rows
-- directly; this table dedupes reviews seen across polls.
CREATE TABLE IF NOT EXISTS pr_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES github_projects(id) ON DELETE CASCADE,
  content_id text NOT NULL,
  github_review_id text NOT NULL,
  author_login text,
  state text,
  body text,
  url text,
  submitted_at timestamptz,
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, github_review_id)
);
