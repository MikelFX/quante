-- Per-project PayPal credentials (Comgate/GoPay columns already exist
-- from migration-payment-credentials.sql). Values are AES-256-GCM encrypted
-- by the app before insert (see lib/crypto.ts).

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS paypal_client_id     text,
  ADD COLUMN IF NOT EXISTS paypal_client_secret text;
