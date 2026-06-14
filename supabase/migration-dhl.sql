-- DHL Express integration: credentials per project + country field on orders.

ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS dhl_api_key text,
  ADD COLUMN IF NOT EXISTS dhl_api_secret text,
  ADD COLUMN IF NOT EXISTS dhl_account_number text;

-- Country code on orders (ISO 3166-1 alpha-2) — needed for DHL and any international courier.
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS shipping_country text;
