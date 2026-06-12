-- Per-project shop settings: custom email sender, payment test mode, Packeta credentials.
-- All columns added to project_secrets (already exists, one row per project).

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS resend_from_email text,         -- e.g. "objednavky@mujshop.cz" (must be a verified Resend domain)
  ADD COLUMN IF NOT EXISTS payment_test_mode boolean NOT NULL DEFAULT true,  -- true = test mode for all gateways
  ADD COLUMN IF NOT EXISTS zasilkovna_api_key text,        -- Packeta client API key
  ADD COLUMN IF NOT EXISTS zasilkovna_api_password text;   -- Packeta client API password (for parcel creation)
