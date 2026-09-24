-- migration-security3-store-api.sql — security re-audit 2026-09, group "store-api" (R10, R8)
--
-- Atomic caps for unpaid (dobirka / prevod) store orders. Those orders email the
-- customer address immediately, so /api/store/checkout caps them per hour:
--   5 per recipient per store, 8 per recipient across all stores, 100 per store.
-- The caps used to be count queries run before the insert, so a burst of parallel
-- requests all read the same count and all got through. reserve_unpaid_order_slot()
-- takes transaction-scoped advisory locks on the lower-cased recipient and on the
-- project, counts the reservations made in the last hour and records a new one — all
-- in one transaction, so concurrent callers are serialised per recipient / per store.
--
-- The route falls back to the old (racy) count queries while this migration hasn't
-- run, so it can be applied at any time. Idempotent: safe to run more than once.
-- File only — review before running.

CREATE TABLE IF NOT EXISTS store_unpaid_order_slots (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL,
  email text NOT NULL,              -- lower-cased, trimmed recipient
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Server-only table (service role bypasses RLS); no policies = no client access.
ALTER TABLE store_unpaid_order_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON store_unpaid_order_slots FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS store_unpaid_order_slots_email_created_idx
  ON store_unpaid_order_slots (email, created_at DESC);
CREATE INDEX IF NOT EXISTS store_unpaid_order_slots_project_created_idx
  ON store_unpaid_order_slots (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_unpaid_order_slots_created_idx
  ON store_unpaid_order_slots (created_at);


-- Returns 'ok' when a slot was reserved, otherwise the cap that was hit:
-- 'recipient_global' | 'recipient' | 'project'. Raises on invalid input.
CREATE OR REPLACE FUNCTION reserve_unpaid_order_slot(p_project_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_since timestamptz := now() - interval '1 hour';
  v_count integer;
BEGIN
  IF p_project_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'reserve_unpaid_order_slot: project and email are required';
  END IF;

  -- Always recipient first, then project: every caller takes the locks in the same
  -- order, so two reservations can never deadlock. Released at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended('store_unpaid_email:' || v_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('store_unpaid_project:' || p_project_id::text, 0));

  SELECT count(*) INTO v_count
    FROM store_unpaid_order_slots
   WHERE email = v_email AND created_at >= v_since;
  IF v_count >= 8 THEN
    RETURN 'recipient_global';
  END IF;

  SELECT count(*) INTO v_count
    FROM store_unpaid_order_slots
   WHERE email = v_email AND project_id = p_project_id AND created_at >= v_since;
  IF v_count >= 5 THEN
    RETURN 'recipient';
  END IF;

  SELECT count(*) INTO v_count
    FROM store_unpaid_order_slots
   WHERE project_id = p_project_id AND created_at >= v_since;
  IF v_count >= 100 THEN
    RETURN 'project';
  END IF;

  INSERT INTO store_unpaid_order_slots (project_id, email) VALUES (p_project_id, v_email);

  -- Housekeeping: only the last hour matters; prune old rows now and then.
  IF random() < 0.02 THEN
    DELETE FROM store_unpaid_order_slots WHERE created_at < now() - interval '1 day';
  END IF;

  RETURN 'ok';
END;
$$;

-- Only the server (service role) may reserve slots.
REVOKE ALL ON FUNCTION reserve_unpaid_order_slot(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_unpaid_order_slot(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_unpaid_order_slot(uuid, text) TO service_role;


-- ─── Per-recipient cap for store-API customer mails (re-audit R8) ──────────────
-- PATCH /api/store/orders/[orderId] and .../zasilkovna-shipment mail the order's
-- customer address on the transition to shipped / refunded. Each such mail must reserve
-- a slot here: at most 10 per recipient per hour across ALL stores, counted and recorded
-- under an advisory lock on the lower-cased address (so parallel requests can't all read
-- the same count). The route falls back to an in-memory cap until this has run.

CREATE TABLE IF NOT EXISTS store_order_mail_slots (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL,
  order_id uuid,
  email text NOT NULL,              -- lower-cased, trimmed recipient
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE store_order_mail_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON store_order_mail_slots FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS store_order_mail_slots_email_created_idx
  ON store_order_mail_slots (email, created_at DESC);
CREATE INDEX IF NOT EXISTS store_order_mail_slots_created_idx
  ON store_order_mail_slots (created_at);

-- Returns 'ok' when a slot was reserved, 'recipient' when the cap was hit.
CREATE OR REPLACE FUNCTION reserve_order_mail_slot(p_project_id uuid, p_order_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_count integer;
BEGIN
  IF p_project_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'reserve_order_mail_slot: project and email are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('store_order_mail:' || v_email, 0));

  SELECT count(*) INTO v_count
    FROM store_order_mail_slots
   WHERE email = v_email AND created_at >= now() - interval '1 hour';
  IF v_count >= 10 THEN
    RETURN 'recipient';
  END IF;

  INSERT INTO store_order_mail_slots (project_id, order_id, email) VALUES (p_project_id, p_order_id, v_email);

  IF random() < 0.02 THEN
    DELETE FROM store_order_mail_slots WHERE created_at < now() - interval '1 day';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION reserve_order_mail_slot(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_order_mail_slot(uuid, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_order_mail_slot(uuid, uuid, text) TO service_role;
