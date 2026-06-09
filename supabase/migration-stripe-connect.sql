-- Stripe Connect Express — per-project connected account
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS stripe_connect_account_id   text;
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS stripe_connect_onboarded     boolean NOT NULL DEFAULT false;
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false;

-- Fast lookup by connected account ID (used in account.updated webhook)
CREATE INDEX IF NOT EXISTS project_secrets_connect_account_idx
  ON project_secrets (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;
