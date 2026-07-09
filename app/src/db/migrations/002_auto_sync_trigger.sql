ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_trigger_check;
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_trigger_check CHECK (trigger IN ('scheduled', 'manual', 'webhook', 'auto'));
