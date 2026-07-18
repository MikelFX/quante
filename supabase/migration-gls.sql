-- GLS (MyGLS API) shipping credentials per project
ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS gls_username text,
  ADD COLUMN IF NOT EXISTS gls_password text,
  ADD COLUMN IF NOT EXISTS gls_client_number text,
  ADD COLUMN IF NOT EXISTS gls_country text DEFAULT 'cz';
