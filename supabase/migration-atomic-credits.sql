-- Atomic credit debit function.
-- Uses a per-user advisory lock to prevent race conditions when two concurrent
-- requests both read the same balance and both attempt to debit it.
--
-- Run this in the Supabase SQL editor (Database → SQL Editor → New query).
-- After running, call via: supabase.rpc('debit_credits', { p_user_id, p_amount, p_reason, p_ref_id })

CREATE OR REPLACE FUNCTION debit_credits(
  p_user_id  uuid,
  p_amount   integer,
  p_reason   text,
  p_ref_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance     integer;
  v_new_balance integer;
  v_row_id      uuid;
BEGIN
  -- Advisory lock keyed on the user ID — serialises concurrent debits for this user.
  -- The lock is held until the transaction commits or rolls back.
  PERFORM pg_advisory_xact_lock(('x' || substr(p_user_id::text, 1, 16))::bit(64)::bigint);

  SELECT COALESCE(balance_after, 0)
    INTO v_balance
    FROM credit_ledger
   WHERE user_id = p_user_id
   ORDER BY created_at DESC
   LIMIT 1;

  v_balance := COALESCE(v_balance, 0);

  IF v_balance < p_amount THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_credits',
      'balance', v_balance
    );
  END IF;

  v_new_balance := v_balance - p_amount;

  INSERT INTO credit_ledger(user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, -p_amount, p_reason, p_ref_id, v_new_balance)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'ok',      true,
    'balance', v_new_balance,
    'id',      v_row_id
  );
END;
$$;

-- Allow the API to call this function
GRANT EXECUTE ON FUNCTION debit_credits(uuid, integer, text, uuid) TO service_role;
