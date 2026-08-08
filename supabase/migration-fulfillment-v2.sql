-- Fulfillment v2 (2026-08-07) — byrd integration hardening, per quante-fulfillment-byrd-spec.md.
-- NOT RUN AGAINST PRODUCTION. Prepared as a file only — run in the Supabase SQL editor once
-- reviewed and approved.
--
-- Builds on migration-byrd.sql (F5), which already added byrd_api_key/byrd_api_secret to
-- project_secrets and fulfillment_provider/fulfillment_ref/fulfillment_status to store_orders.
-- Those columns are NOT removed or changed here — they remain the fast, denormalized "what's
-- the fulfillment state of this order" read used by the Studio order list UI. This migration
-- adds the tables that were missing for the spec's idempotency, token-caching, and
-- request-logging requirements; lib/fulfillment/auto-ship.ts keeps store_orders' three columns
-- in sync with fulfillment_shipments (the new source of truth) after every write.
--
-- Order of operations if/when this is approved: run this migration BEFORE relying on
-- lib/fulfillment/providers/byrd/client.ts's DB-backed token cache or lib/fulfillment/auto-ship.ts's
-- idempotent create path — both degrade gracefully (in-memory-only cache, or a clear
-- "migration not run" error) if the tables don't exist yet, but are meant to run with them.

-- ── last stock sync timestamp ─────────────────────────────────────────────────
-- Companion to the existing byrd_api_key/byrd_api_secret columns on project_secrets
-- (migration-byrd.sql) — written by app/api/cron/fulfillment-stock after each successful
-- sync, read by a future admin UI ("last synced 5 minutes ago").
ALTER TABLE project_secrets ADD COLUMN IF NOT EXISTS byrd_last_stock_sync_at timestamptz;

-- ── fulfillment_tokens — cached provider auth tokens ─────────────────────────────
-- One row per (project, provider). See lib/fulfillment/providers/byrd/client.ts getToken() —
-- exists specifically to stay under byrd's 5-calls/minute login rate limit
-- (docs/frequency-of-calls-to-the-api). Server-only table (service-role client), RLS enabled
-- with no policies = deny-all for anon/authenticated, consistent with other server-only tables.
CREATE TABLE IF NOT EXISTS fulfillment_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider)
);
ALTER TABLE fulfillment_tokens ENABLE ROW LEVEL SECURITY;

-- ── fulfillment_api_log — request log (never credentials or body) ───────────────
CREATE TABLE IF NOT EXISTS fulfillment_api_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fulfillment_api_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS fulfillment_api_log_project_idx ON fulfillment_api_log (project_id, created_at DESC);
-- No retention policy set here — this table grows unbounded with usage. Consider a scheduled
-- cleanup (e.g. delete rows older than 90 days) once real call volume is known.

-- ── fulfillment_product_links — Quante product/variant <-> provider SKU match ───
-- Quante has no dedicated "products" table with a SKU column (code-gen stores keep products
-- in generated data/products.ts files; store_inventory tracks stock by product_id/variant_id
-- matching the manifest's Product.id, not a separate SKU). `sku` here is what was actually
-- sent to the provider — see lib/fulfillment/types.ts QuanteProduct doc comment for the
-- product_id-as-sku convention this integration uses.
CREATE TABLE IF NOT EXISTS fulfillment_product_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'byrd',
  product_id text NOT NULL,
  variant_id text,
  sku text NOT NULL,
  external_product_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fulfillment_product_links ENABLE ROW LEVEL SECURITY;
-- Postgres doesn't allow a function call (COALESCE) inside a table-level UNIQUE constraint —
-- only plain columns are allowed there. variant_id is nullable (not every product has variants),
-- and NULL <> NULL means a plain UNIQUE(project_id, provider, product_id, variant_id) would
-- happily allow duplicate rows for two variant-less links to the same product. A unique
-- expression index sidesteps both problems: COALESCE(variant_id, '') treats "no variant" as a
-- single consistent value, and expression indexes are allowed to call functions.
CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_product_links_unique_idx
  ON fulfillment_product_links (project_id, provider, product_id, COALESCE(variant_id, ''));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'fulfillment_product_links' AND policyname = 'Users can view own fulfillment product links'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own fulfillment product links" ON fulfillment_product_links
      FOR SELECT USING (
        project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> ''sub''))
      )';
  END IF;
END $$;

-- ── fulfillment_shipments — THE idempotency table (spec section 6) ──────────────
-- unique(order_id) is what makes "Stripe webhook fires 3 times -> exactly one byrd shipment"
-- work: lib/fulfillment/auto-ship.ts inserts a 'creating' row FIRST, and only calls
-- provider.createShipment() if that insert succeeds. A second/third concurrent attempt for the
-- same order hits the unique constraint, gets a Postgres 23505 error, and is treated as "already
-- being handled" — not retried, not errored to the caller. See lib/fulfillment/auto-ship.ts and
-- __tests__/fulfillment-byrd.test.mjs for the exact logic this constraint backs.
CREATE TABLE IF NOT EXISTS fulfillment_shipments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'byrd',
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  external_shipment_id text,
  status text NOT NULL DEFAULT 'creating',   -- creating | created | failed | sent | delivered | returned
  tracking_number text,
  tracking_url text,
  carrier text,
  customer_notified_at timestamptz,          -- set only AFTER the tracking email send succeeds — see spec section 7
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);
ALTER TABLE fulfillment_shipments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS fulfillment_shipments_status_idx ON fulfillment_shipments (status);
CREATE INDEX IF NOT EXISTS fulfillment_shipments_project_idx ON fulfillment_shipments (project_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'fulfillment_shipments' AND policyname = 'Users can view own fulfillment shipments'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can view own fulfillment shipments" ON fulfillment_shipments
      FOR SELECT USING (
        project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> ''sub''))
      )';
  END IF;
END $$;

-- Verification query — run after applying:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
--   AND table_name IN ('fulfillment_tokens','fulfillment_api_log','fulfillment_product_links','fulfillment_shipments');
-- should return all four rows.
