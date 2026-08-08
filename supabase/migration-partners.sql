-- Partner / reseller program for agencies building stores through Quante.
--
-- SAFETY NOTE (per explicit user instruction): this migration and everything built on top
-- of it is INFRASTRUCTURE ONLY. Commission is CALCULATED and recorded as an append-only
-- bookkeeping entry (partner_commission_ledger), exactly mirroring how credit_ledger works.
-- No table, column, or code path here ever moves real money, calls a Stripe Connect
-- transfer/payout API, or marks anything as actually paid. 'status' on the ledger includes
-- a 'paid' value for future use, but nothing in this codebase ever writes it — that's a
-- deliberate, separate feature for the user to build and activate later.
--
-- Do NOT run against production from this session — file only, per project safety rules.
--
-- NAMING NOTE: this is unrelated to the existing `users.tier = 'agency'` subscription tier
-- (lib/tier.ts) — that's a single account paying for a higher project limit on their own
-- projects. This is a separate reseller/affiliate concept: a "partner" account that earns
-- commission on OTHER projects assigned to it. Kept as distinct tables/naming (partners,
-- not agency_*) specifically to avoid confusing the two.

CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,              -- Clerk user_id of the partner's own Quante account
  company_name text NOT NULL,
  contact_email text NOT NULL,
  referral_code text NOT NULL UNIQUE,        -- short code for future referral-link signup flows
  commission_rate_bps int NOT NULL DEFAULT 1000 CHECK (commission_rate_bps BETWEEN 0 AND 5000), -- 10% default, hard-capped at 50%
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  payout_iban text,                          -- captured for later use only — no code path reads this today
  payout_holder_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partners_user_id_idx ON partners(user_id);
CREATE INDEX IF NOT EXISTS partners_referral_code_idx ON partners(referral_code);

CREATE TRIGGER partners_updated_at BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Projects assigned to a partner (the client stores the agency builds/manages through
-- Quante). A project can be assigned to at most one partner at a time.
CREATE TABLE IF NOT EXISTS partner_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed'))
);

CREATE INDEX IF NOT EXISTS partner_projects_partner_id_idx ON partner_projects(partner_id);

-- Append-only commission ledger — same immutable-audit-trail + running-balance pattern as
-- credit_ledger (schema.sql). One row per commission-earning event (a hosting subscription
-- renewal on an assigned project). UNIQUE(partner_id, ref_id) makes recording idempotent —
-- the Stripe webhook can safely call this on every subscription event without double-
-- counting; see lib/partner-commission.ts.
CREATE TABLE IF NOT EXISTS partner_commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  delta_cents integer NOT NULL,              -- commission amount for this entry, in currency's minor unit
  currency text NOT NULL DEFAULT 'usd',
  reason text NOT NULL,                      -- e.g. 'hosting_subscription_renewal'
  ref_id text NOT NULL,                      -- e.g. '<stripe_subscription_id>:<period_end_iso>' — one entry per billing period
  balance_after_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'approved', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, ref_id)
);

CREATE INDEX IF NOT EXISTS partner_commission_ledger_partner_id_idx
  ON partner_commission_ledger(partner_id, created_at DESC);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_commission_ledger ENABLE ROW LEVEL SECURITY;

-- RLS uses the canonical (auth.jwt() ->> 'sub') pattern established in
-- migration-rls-consistency.sql — NOT auth.uid(). All server code reads through
-- supabaseAdmin (service role, bypasses RLS) anyway; these policies are the defense-in-depth
-- layer for any future direct-from-browser Supabase access.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partners' AND policyname = 'partners read own row') THEN
    CREATE POLICY "partners read own row" ON partners FOR SELECT USING ((auth.jwt() ->> 'sub') = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_projects' AND policyname = 'partner_projects read own') THEN
    CREATE POLICY "partner_projects read own" ON partner_projects FOR SELECT USING (
      partner_id IN (SELECT id FROM partners WHERE user_id = (auth.jwt() ->> 'sub'))
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_commission_ledger' AND policyname = 'partner_commission_ledger read own') THEN
    CREATE POLICY "partner_commission_ledger read own" ON partner_commission_ledger FOR SELECT USING (
      partner_id IN (SELECT id FROM partners WHERE user_id = (auth.jwt() ->> 'sub'))
    );
  END IF;
END $$;
