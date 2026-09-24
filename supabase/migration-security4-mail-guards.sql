-- migration-security4-mail-guards.sql — final security audit 2026-09, group "mail-guards" (F8)
--
-- Daily per-store cap on the customer confirmation mails of unpaid (dobirka / prevod)
-- orders. /api/store/checkout sends that mail from the platform order mailbox (unless the
-- store has a verified sending domain) to an address typed into a public form, so on top
-- of the hourly caps of reserve_unpaid_order_slot() (migration-security3-store-api.sql)
-- every such mail must now reserve a slot here: at most p_limit per store per rolling
-- 24 hours. The route passes a lower limit for stores without a paid hosting plan (free
-- trial) than for paying stores. Counted and recorded under a transaction-scoped advisory
-- lock on the project, so parallel requests can't all read the same count.
--
-- One slot covers both mails of an unpaid order (customer confirmation + merchant
-- notice). The later "shipped" mail of an offline order that was never marked paid
-- takes another slot (Studio carrier routes — app/api/projects/[id]/store-orders/_lib/
-- ship-guard.ts; lib/order-emails.ts reserveUnpaidMailSlot is the shared helper).
--
-- reserve_merchant_notice_slot() below caps the merchant new-order notice of unpaid
-- orders per RECIPIENT across all stores: the merchant address comes from the manifest
-- / merchant_json and is never verified, so many throwaway stores naming one victim as
-- their "merchant" address must not be able to mail that victim more than p_limit
-- times per rolling 24 hours between them.
--
-- A refused slot only suppresses mail — the order itself is always created (it shows
-- in the Studio). Until this migration has run (or if an RPC errors) the app falls back
-- to a non-atomic DB count plus an in-memory per-instance cap, so it can be applied at
-- any time — but run it: the fallback is weaker (per instance on Vercel).
-- Idempotent: safe to run more than once. File only — review before running.

CREATE TABLE IF NOT EXISTS store_unpaid_mail_slots (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Server-only table (service role bypasses RLS); no policies = no client access.
ALTER TABLE store_unpaid_mail_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON store_unpaid_mail_slots FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS store_unpaid_mail_slots_project_created_idx
  ON store_unpaid_mail_slots (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_unpaid_mail_slots_created_idx
  ON store_unpaid_mail_slots (created_at);


-- Returns 'ok' when a slot was reserved, 'project_daily' when the cap was hit.
-- Raises on invalid input.
CREATE OR REPLACE FUNCTION reserve_unpaid_mail_slot(p_project_id uuid, p_limit integer)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_project_id IS NULL OR p_limit IS NULL OR p_limit < 0 THEN
    RAISE EXCEPTION 'reserve_unpaid_mail_slot: project and a non-negative limit are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('store_unpaid_mail_project:' || p_project_id::text, 0));

  SELECT count(*) INTO v_count
    FROM store_unpaid_mail_slots
   WHERE project_id = p_project_id AND created_at >= now() - interval '24 hours';
  IF v_count >= p_limit THEN
    RETURN 'project_daily';
  END IF;

  INSERT INTO store_unpaid_mail_slots (project_id) VALUES (p_project_id);

  -- Housekeeping: only the last 24 hours matter; prune old rows now and then.
  IF random() < 0.02 THEN
    DELETE FROM store_unpaid_mail_slots WHERE created_at < now() - interval '2 days';
  END IF;

  RETURN 'ok';
END;
$$;

-- Only the server (service role) may reserve slots.
REVOKE ALL ON FUNCTION reserve_unpaid_mail_slot(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_unpaid_mail_slot(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_unpaid_mail_slot(uuid, integer) TO service_role;


-- ─── Merchant new-order notices of unpaid orders, per recipient across stores ─────
CREATE TABLE IF NOT EXISTS store_merchant_notice_slots (
  id bigserial PRIMARY KEY,
  email text NOT NULL,          -- lower-cased merchant address
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_merchant_notice_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON store_merchant_notice_slots FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS store_merchant_notice_slots_email_created_idx
  ON store_merchant_notice_slots (email, created_at DESC);
CREATE INDEX IF NOT EXISTS store_merchant_notice_slots_created_idx
  ON store_merchant_notice_slots (created_at);

-- Returns 'ok' when a slot was reserved, 'recipient_daily' when the cap was hit.
-- Raises on invalid input.
CREATE OR REPLACE FUNCTION reserve_merchant_notice_slot(p_project_id uuid, p_email text, p_limit integer)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_count integer;
BEGIN
  IF p_project_id IS NULL OR v_email = '' OR p_limit IS NULL OR p_limit < 0 THEN
    RAISE EXCEPTION 'reserve_merchant_notice_slot: project, email and a non-negative limit are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('store_merchant_notice:' || v_email, 0));

  SELECT count(*) INTO v_count
    FROM store_merchant_notice_slots
   WHERE email = v_email AND created_at >= now() - interval '24 hours';
  IF v_count >= p_limit THEN
    RETURN 'recipient_daily';
  END IF;

  INSERT INTO store_merchant_notice_slots (email, project_id) VALUES (v_email, p_project_id);

  IF random() < 0.02 THEN
    DELETE FROM store_merchant_notice_slots WHERE created_at < now() - interval '2 days';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION reserve_merchant_notice_slot(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_merchant_notice_slot(uuid, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_merchant_notice_slot(uuid, text, integer) TO service_role;
