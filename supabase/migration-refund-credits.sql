-- Atomic, idempotent credit refund for failed generations/iterations.
-- Refunds the exact amount of the original debit (reason 'generate' or 'iterate')
-- referenced by p_ref_id. Safe to call multiple times — refunds at most once.
--
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
-- Call via: supabase.rpc('refund_credits', { p_user_id, p_ref_id })

CREATE OR REPLACE FUNCTION refund_credits(
  p_user_id text,
  p_ref_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_debit_amount integer;
  v_balance      integer;
  v_new_balance  integer;
  v_existing     uuid;
  v_row_id       uuid;
BEGIN
  -- Serialise all ledger writes for this user (same locking scheme as debit_credits).
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));

  -- Idempotency: already refunded for this ref?
  SELECT id INTO v_existing
    FROM credit_ledger
   WHERE user_id = p_user_id
     AND ref_id = p_ref_id
     AND reason = 'generation_failed'
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT COALESCE(balance_after, 0) INTO v_balance
      FROM credit_ledger
     WHERE user_id = p_user_id
     ORDER BY created_at DESC
     LIMIT 1;
    RETURN jsonb_build_object(
      'ok', true, 'already_refunded', true, 'balance', COALESCE(v_balance, 0)
    );
  END IF;

  -- Find the original debit (generate = -10, iterate = -1).
  SELECT ABS(delta) INTO v_debit_amount
    FROM credit_ledger
   WHERE user_id = p_user_id
     AND ref_id = p_ref_id
     AND delta < 0
     AND reason IN ('generate', 'iterate')
   LIMIT 1;

  IF v_debit_amount IS NULL THEN
    -- Nothing was debited for this ref (e.g. agency user) — nothing to refund.
    RETURN jsonb_build_object('ok', true, 'refunded', 0, 'no_debit', true);
  END IF;

  SELECT COALESCE(balance_after, 0) INTO v_balance
    FROM credit_ledger
   WHERE user_id = p_user_id
   ORDER BY created_at DESC
   LIMIT 1;

  v_balance := COALESCE(v_balance, 0);
  v_new_balance := v_balance + v_debit_amount;

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, v_debit_amount, 'generation_failed', p_ref_id, v_new_balance)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'ok', true, 'refunded', v_debit_amount, 'balance', v_new_balance, 'id', v_row_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION refund_credits(text, uuid) TO service_role;
