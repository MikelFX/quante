-- Qbox services: agents sell to agents (2026-11-06). Idempotent; safe to re-run. Run manually in the
-- Supabase SQL Editor AFTER migration-qbox-beta.sql and migration-qbox-open.sql.
-- Until it has run, the services API answers "not set up" and nothing is charged.
--
-- qbox_wallets          the seller's own wallet (proved by an EIP-191 signature). Payments for its
--                       services go there directly; we never hold or pay out anyone's USDC.
-- qbox_services         the directory: one paid HTTP service per row, called via /api/qbox/v1/x/<slug>
-- qbox_service_calls    one row per paid call attempt (nonce = the buyer's payment authorization, unique,
--                       so one payment buys one call). Statistics and the public counter come from here.
--                       Our fee itself is a 'charge' row in qbox_topups (the seller's balance).
-- qbox_service_reports  reports from anyone; the operator blocks a service in Admin → Qbox.
--
-- Service role only (routes use supabaseAdmin). No policies on purpose.

CREATE TABLE IF NOT EXISTS qbox_wallets (
  user_id      text PRIMARY KEY,
  address      text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  network      text NOT NULL,
  signature    text NOT NULL,
  message      text NOT NULL CHECK (char_length(message) <= 500),
  verified_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qbox_services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  user_id       text NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 60),
  description   text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 1000),
  price_units   bigint NOT NULL CHECK (price_units BETWEEN 1000 AND 100000000),   -- USDC, 6 decimals
  upstream      jsonb NOT NULL,
  input_schema  jsonb,
  example       text CHECK (char_length(example) <= 2000),
  tags          text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'paused', 'removed', 'blocked')),
  wallet        text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  network       text NOT NULL,
  blocked_reason text CHECK (char_length(blocked_reason) <= 300),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qbox_services_user_idx ON qbox_services (user_id);
CREATE INDEX IF NOT EXISTS qbox_services_live_idx ON qbox_services (created_at DESC) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS qbox_service_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   uuid NOT NULL REFERENCES qbox_services (id) ON DELETE CASCADE,
  seller_id    text NOT NULL,
  payer        text,
  price_units  bigint NOT NULL,
  fee_vcpu_minutes numeric(10, 2) NOT NULL DEFAULT 0,
  nonce        text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'upstream_failed', 'settle_failed')),
  upstream_status int,
  transaction  text,
  network      text,
  duration_ms  int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qbox_service_calls_service_idx ON qbox_service_calls (service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qbox_service_calls_paid_idx ON qbox_service_calls (created_at) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS qbox_service_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  uuid NOT NULL REFERENCES qbox_services (id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  reporter    text CHECK (char_length(reporter) <= 200),   -- e-mail or wallet, optional
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qbox_service_reports_service_idx ON qbox_service_reports (service_id);

ALTER TABLE qbox_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_service_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_service_reports ENABLE ROW LEVEL SECURITY;

-- Public numbers (same rule as marketStats() in lib/qbox/services/model.ts):
--   SELECT count(*) AS paid_calls, count(DISTINCT seller_id) AS sellers, count(DISTINCT lower(payer)) AS buyers,
--          sum(price_units) / 1e6 AS volume_usd
--   FROM qbox_service_calls WHERE status = 'paid';
