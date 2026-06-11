CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('org', 'user')),
  owner_login text NOT NULL,
  project_number integer NOT NULL,
  title text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_login, project_number)
);

CREATE TABLE IF NOT EXISTS github_repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  owner_login text NOT NULL,
  repo_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, owner_login, repo_name)
);

CREATE TABLE IF NOT EXISTS project_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  github_item_id text NOT NULL,
  content_type text,
  content_id text,
  content_url text,
  title text,
  state text,
  raw jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, github_item_id)
);

CREATE TABLE IF NOT EXISTS item_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  github_item_id text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_snapshots_item_created_idx ON item_snapshots(project_id, github_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS issue_pr_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  content_id text NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_pr_snapshots_content_created_idx ON issue_pr_snapshots(project_id, content_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES github_projects(id) ON DELETE CASCADE,
  content_id text NOT NULL,
  github_comment_id text NOT NULL,
  author_login text,
  body text,
  url text,
  github_updated_at timestamptz,
  raw jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, github_comment_id)
);

CREATE TABLE IF NOT EXISTS changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES github_projects(id) ON DELETE SET NULL,
  repository text,
  content_id text,
  change_type text NOT NULL,
  actor_login text,
  title text,
  url text,
  summary text,
  before_value jsonb,
  after_value jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL CHECK (source IN ('poll', 'webhook', 'manual')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  summarized_at timestamptz
);

CREATE INDEX IF NOT EXISTS changes_project_time_idx ON changes(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS changes_unsummarized_idx ON changes(summarized_at) WHERE summarized_at IS NULL;

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'webhook')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  projects_checked integer NOT NULL DEFAULT 0,
  changes_found integer NOT NULL DEFAULT 0,
  error text
);

CREATE TABLE IF NOT EXISTS summary_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  provider text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text
);

CREATE TABLE IF NOT EXISTS summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_run_id uuid REFERENCES summary_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  style text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  short_body text NOT NULL,
  change_count integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id uuid REFERENCES summaries(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'telegram')),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  error text
);
