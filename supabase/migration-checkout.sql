-- Per-project notification token for webhook callbacks to Quante
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS notification_token text UNIQUE;

-- Index for fast lookups by token
CREATE INDEX IF NOT EXISTS project_secrets_notification_token_idx
  ON project_secrets (notification_token)
  WHERE notification_token IS NOT NULL;
