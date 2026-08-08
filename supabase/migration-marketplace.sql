-- Marketplace for components & starter stores — opens up `custom_components`
-- (migration-custom-components.sql) and full-store code snapshots as sellable listings
-- between Quante users, with a platform revenue share.
--
-- SAFETY NOTE (per explicit user instruction, same as migration-partners.sql): this is
-- INFRASTRUCTURE ONLY. "Purchasing" here records bookkeeping (a purchase row + a seller
-- earnings ledger entry) and grants the buyer a copy of the content — it does NOT charge
-- any real payment method. No Stripe charge, no Connect transfer, nothing marked "paid" by
-- any code path. Wiring a real charge (e.g. Stripe Checkout before calling
-- POST /api/marketplace/purchases, the same way credit-pack purchases work today) is a
-- deliberate, separate activation step left for the user. See lib/marketplace.ts.
--
-- Do NOT run against production from this session — file only, per project safety rules.

-- Listings are SNAPSHOTS, not live references — the seller's original component/project
-- can change or be deleted after publishing without affecting a listing already on sale,
-- and without affecting buyers who already purchased it. Standard marketplace pattern.
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id        text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('component', 'starter_store')),
  source_component_id   uuid REFERENCES custom_components(id) ON DELETE SET NULL, -- kind='component' only
  source_project_id     uuid REFERENCES projects(id) ON DELETE SET NULL,          -- kind='starter_store' only (and provenance for 'component')
  snapshot              jsonb NOT NULL,      -- { name, code } for component, { files } for starter_store
  title                 text NOT NULL,
  description           text,
  price_cents           integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency              text NOT NULL DEFAULT 'usd',
  -- 'component' listings snapshotted from an already-validated custom_components row
  -- (passed_validation = true) are auto-listed — they went through the sandboxed
  -- component-generation validator (CLAUDE.md §4.3: no network calls, no arbitrary
  -- imports, allowlisted primitives only) before ever being saved. Everything else
  -- (unvalidated components, and ALL starter_store listings — a full code export has no
  -- equivalent automated validation today) requires admin review, same gate as partners.
  passed_validation     boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'listed', 'delisted', 'rejected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings(status, created_at DESC);
CREATE INDEX IF NOT EXISTS marketplace_listings_seller_idx ON marketplace_listings(seller_user_id);

CREATE TRIGGER marketplace_listings_updated_at BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- One purchase per (listing, buyer) — can't buy the same listing twice. Price/fee are
-- frozen at purchase time so later listing-price changes never retroactively affect past
-- purchases or seller earnings already recorded.
CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id            uuid NOT NULL REFERENCES marketplace_listings(id) ON DELETE RESTRICT,
  buyer_user_id         text NOT NULL,
  seller_user_id        text NOT NULL,
  target_project_id     uuid REFERENCES projects(id) ON DELETE SET NULL, -- where the content was installed
  price_cents           integer NOT NULL,
  currency              text NOT NULL,
  platform_fee_bps      integer NOT NULL,
  platform_fee_cents    integer NOT NULL,
  seller_earning_cents  integer NOT NULL,
  status                text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, buyer_user_id)
);

CREATE INDEX IF NOT EXISTS marketplace_purchases_buyer_idx ON marketplace_purchases(buyer_user_id);
CREATE INDEX IF NOT EXISTS marketplace_purchases_seller_idx ON marketplace_purchases(seller_user_id);

-- Append-only seller earnings ledger — same immutable-audit-trail + running-balance
-- pattern as credit_ledger and partner_commission_ledger. 'status' includes 'paid' for
-- future use; no code path in this codebase writes it.
CREATE TABLE IF NOT EXISTS marketplace_seller_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id        text NOT NULL,
  purchase_id           uuid NOT NULL REFERENCES marketplace_purchases(id) ON DELETE CASCADE UNIQUE,
  delta_cents           integer NOT NULL,
  currency              text NOT NULL,
  balance_after_cents   integer NOT NULL,
  status                text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'approved', 'paid')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_seller_ledger_seller_idx
  ON marketplace_seller_ledger(seller_user_id, created_at DESC);

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_seller_ledger ENABLE ROW LEVEL SECURITY;

-- RLS uses the canonical (auth.jwt() ->> 'sub') pattern (migration-rls-consistency.sql),
-- not auth.uid(). All server code reads through supabaseAdmin (service role) regardless —
-- these are defense-in-depth for any future direct-from-browser Supabase access.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_listings' AND policyname = 'marketplace_listings public read listed') THEN
    CREATE POLICY "marketplace_listings public read listed" ON marketplace_listings
      FOR SELECT USING (status = 'listed' OR seller_user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_purchases' AND policyname = 'marketplace_purchases read own') THEN
    CREATE POLICY "marketplace_purchases read own" ON marketplace_purchases
      FOR SELECT USING (buyer_user_id = (auth.jwt() ->> 'sub') OR seller_user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_seller_ledger' AND policyname = 'marketplace_seller_ledger read own') THEN
    CREATE POLICY "marketplace_seller_ledger read own" ON marketplace_seller_ledger
      FOR SELECT USING (seller_user_id = (auth.jwt() ->> 'sub'));
  END IF;
END $$;
