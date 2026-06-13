-- Per-project payment gateway credentials (Comgate, GoPay)
-- Each merchant enters their own gateway credentials; payments go directly to their accounts.

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS comgate_merchant_id text,
  ADD COLUMN IF NOT EXISTS comgate_secret      text,
  ADD COLUMN IF NOT EXISTS gopay_client_id     text,
  ADD COLUMN IF NOT EXISTS gopay_client_secret text,
  ADD COLUMN IF NOT EXISTS gopay_go_id         text;
