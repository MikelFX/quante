-- Credits v2 — atomic, lock-serialised credit ledger (security audit 2026-09-23).
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor.
-- The app code in lib/credits.ts REQUIRES these functions — deploy this migration
-- BEFORE (or together with) the app code that calls them.
--
-- Problems this fixes:
--   1. Every credit write in the app was "read last balance_after, then insert
--      balance_after = snapshot ± delta". Concurrent requests (or a generation that
--      finishes minutes after its snapshot) overwrote each other → credits minted
--      out of thin air, or paid work done for free.
--   2. The old debit_credits(uuid, ...) could never be called (Clerk ids are text)
--      and used a different advisory-lock key than refund_credits.
--   3. schema.sql created INSERT policies "service writes credit_ledger" /
--      "service writes purchases" WITH CHECK (true) and no TO clause — they apply
--      to the anon + authenticated roles too, so anyone holding the (public) anon
--      key could insert a credit_ledger row with any balance_after via PostgREST.
--      The service role bypasses RLS and never needed these policies.
--   4. SECURITY DEFINER functions are executable by PUBLIC by default in Postgres.
--
-- Every function below: takes pg_advisory_xact_lock(hashtext(user_id)) — the SAME key
-- for every ledger write — so all credit movements for one user are serialised, and
-- computes balance_after from the latest row INSIDE the lock.

-- ── 3. Close direct writes from anon/authenticated ─────────────────────────────
DROP POLICY IF EXISTS "service writes credit_ledger" ON credit_ledger;
DROP POLICY IF EXISTS "service writes purchases" ON purchases;
REVOKE INSERT, UPDATE, DELETE ON credit_ledger FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON purchases FROM anon, authenticated;

-- ── Monotonic ordering column ───────────────────────────────────────────────────
-- created_at defaults to now() = TRANSACTION START time. A transaction that started
-- earlier but waited on the advisory lock inserts its row AFTER a later-started one
-- yet gets an OLDER created_at, so "latest row by created_at" would skip it (its debit
-- silently vanishes from the balance). seq is assigned at INSERT time (inside the
-- lock), so ORDER BY seq is the true write order. Existing rows are backfilled in
-- created_at order so history keeps its meaning.
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS seq bigint;
DO $$
DECLARE v_max bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM credit_ledger WHERE seq IS NULL) THEN
    UPDATE credit_ledger c SET seq = o.rn
      FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM credit_ledger) o
     WHERE c.id = o.id AND c.seq IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'credit_ledger_seq_seq') THEN
    SELECT COALESCE(MAX(seq), 0) INTO v_max FROM credit_ledger;
    EXECUTE format('CREATE SEQUENCE credit_ledger_seq_seq START WITH %s', v_max + 1);
    ALTER SEQUENCE credit_ledger_seq_seq OWNED BY credit_ledger.seq;
  END IF;
END $$;
ALTER TABLE credit_ledger ALTER COLUMN seq SET DEFAULT nextval('credit_ledger_seq_seq');
ALTER TABLE credit_ledger ALTER COLUMN seq SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_seq_idx ON credit_ledger (seq);
CREATE INDEX IF NOT EXISTS credit_ledger_user_seq_idx ON credit_ledger (user_id, seq DESC);
REVOKE ALL ON SEQUENCE credit_ledger_seq_seq FROM anon, authenticated;

-- ── Helper: current balance (caller must already hold the lock) ─────────────────
CREATE OR REPLACE FUNCTION credit_balance_locked(p_user_id text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT balance_after FROM credit_ledger
     WHERE user_id = p_user_id
     ORDER BY seq DESC
     LIMIT 1
  ), 0);
$$;

-- ── Debit ───────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS debit_credits(uuid, integer, text, uuid);

CREATE OR REPLACE FUNCTION debit_credits(
  p_user_id text,
  p_amount  integer,
  p_reason  text,
  p_ref_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_row_id  uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
  v_balance := credit_balance_locked(p_user_id);

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_credits', 'balance', v_balance);
  END IF;

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, -p_amount, p_reason, p_ref_id, v_balance - p_amount)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('ok', true, 'balance', v_balance - p_amount, 'id', v_row_id);
END;
$$;

-- ── Grant (purchases, admin grants) ─────────────────────────────────────────────
-- Idempotent when p_ref_id is given: a second call with the same (user, reason, ref)
-- is a no-op that returns already_granted = true.
CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id text,
  p_amount  integer,
  p_reason  text,
  p_ref_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_row_id  uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_user');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));

  IF p_ref_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM credit_ledger
     WHERE user_id = p_user_id AND reason = p_reason AND ref_id = p_ref_id AND delta > 0
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'balance', credit_balance_locked(p_user_id));
  END IF;

  v_balance := credit_balance_locked(p_user_id);

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, p_amount, p_reason, p_ref_id, v_balance + p_amount)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('ok', true, 'balance', v_balance + p_amount, 'id', v_row_id);
END;
$$;

-- ── Welcome grant — exactly once per user, only if they have no ledger rows ─────
CREATE OR REPLACE FUNCTION grant_welcome_credits(
  p_user_id text,
  p_amount  integer,
  p_reason  text DEFAULT 'welcome_grant'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));

  IF EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'balance', credit_balance_locked(p_user_id));
  END IF;

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, p_amount, p_reason, NULL, p_amount)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('ok', true, 'balance', p_amount, 'id', v_row_id);
END;
$$;

-- ── Refund a specific debit (by ref) — never more than was actually debited ─────
-- Refundable = SUM(debits with this ref + debit reason) − SUM(refunds already made
-- with this ref + refund reason). p_amount NULL = refund everything still refundable;
-- otherwise refunds min(p_amount, refundable). Safe to call repeatedly: once the
-- debit is fully refunded, further calls refund 0.
CREATE OR REPLACE FUNCTION refund_debit(
  p_user_id       text,
  p_ref_id        uuid,
  p_debit_reason  text,
  p_refund_reason text,
  p_amount        integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debited    integer;
  v_refunded   integer;
  v_refundable integer;
  v_amount     integer;
  v_balance    integer;
  v_row_id     uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_ref_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'refunded', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));

  SELECT COALESCE(SUM(-delta), 0) INTO v_debited
    FROM credit_ledger
   WHERE user_id = p_user_id AND ref_id = p_ref_id AND reason = p_debit_reason AND delta < 0;

  -- Count every positive row carrying this ref (any reason), not just p_refund_reason:
  -- otherwise two call sites using different refund reasons for the same debit could
  -- each refund it in full. Grants are excluded ('purchase', 'welcome_grant',
  -- 'admin_grant') — a chargeback clawback is keyed on the purchase id, and the
  -- original purchase grant must not count as "already refunded" (otherwise a won
  -- dispute could never return the clawed-back credits).
  SELECT COALESCE(SUM(delta), 0) INTO v_refunded
    FROM credit_ledger
   WHERE user_id = p_user_id AND ref_id = p_ref_id AND delta > 0
     AND reason NOT IN ('purchase', 'welcome_grant', 'admin_grant');

  v_refundable := v_debited - v_refunded;
  IF v_refundable <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'refunded', 0, 'balance', credit_balance_locked(p_user_id));
  END IF;

  v_amount := LEAST(COALESCE(p_amount, v_refundable), v_refundable);
  v_balance := credit_balance_locked(p_user_id);

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, v_amount, p_refund_reason, p_ref_id, v_balance + v_amount)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('ok', true, 'refunded', v_amount, 'balance', v_balance + v_amount, 'id', v_row_id);
END;
$$;

-- ── Old refund_credits: align lock key (it already used hashtext) and lock it down ─
-- Kept for backwards compatibility; new code uses refund_debit.

-- ── 4. Only the service role may execute these ──────────────────────────────────
REVOKE ALL ON FUNCTION credit_balance_locked(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION debit_credits(text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grant_credits(text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION grant_welcome_credits(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refund_debit(text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refund_credits') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION refund_credits(text, uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION refund_credits(text, uuid) TO service_role';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION credit_balance_locked(text) TO service_role;
GRANT EXECUTE ON FUNCTION debit_credits(text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION grant_credits(text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION grant_welcome_credits(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION refund_debit(text, uuid, text, text, integer) TO service_role;

-- Also lock down other SECURITY DEFINER / mutating helpers that were left executable by PUBLIC.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrement_stock') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION decrement_stock(uuid, text, text, integer) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION decrement_stock(uuid, text, text, integer) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'next_order_number') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION next_order_number(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION next_order_number(uuid) TO service_role';
  END IF;
END $$;

-- Order numbers: make duplicates impossible even under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS store_orders_project_order_number_idx
  ON store_orders (project_id, order_number);

-- Verification:
--   SELECT proname, proacl FROM pg_proc WHERE proname IN
--     ('debit_credits','grant_credits','grant_welcome_credits','refund_debit','refund_credits');
--   -- proacl must NOT contain '=X/' (PUBLIC) or 'anon=' / 'authenticated='.
--   SELECT policyname FROM pg_policies WHERE tablename IN ('credit_ledger','purchases');
--   -- must NOT list "service writes credit_ledger" / "service writes purchases".
