-- migration-security4-identity-gate.sql — final audit 2026-09-23, group "identity-gate" (F0/F10)
-- NOT RUN AGAINST PRODUCTION. Review, then run manually in the Supabase SQL editor.
-- Requires supabase/migration-credits-v2.sql (credit_ledger.seq, credit_balance_locked)
-- and supabase/migration-security3-hosting.sql (hosting_trials).
--
-- Problem: the welcome credits and the one-per-user free hosting trial were keyed only
-- on the Clerk user id. Email aliases (me+1@gmail.com, m.e@gmail.com, googlemail.com, …)
-- all deliver to one inbox, so one person could open any number of verified accounts and
-- take the grant + a 30-day hosted store on each.
--
-- Fix: the app derives NORMALIZED identities from the account's verified emails / phone
-- numbers, server-side from Clerk (app/api/credits/welcome-grant.ts) — lower-case, +tag
-- stripped on every domain, dots stripped and googlemail.com folded into gmail.com,
-- phones as E.164 — and passes them here as SHA-256 hex digests (no plaintext email /
-- phone is stored).
--
--   welcome_grants   — one row per identity that has received a welcome grant. An
--                      identity already held by ANOTHER user refuses the grant.
--   user_identities  — every (identity, user) pair seen by the welcome grant (granted or
--                      refused), by every hosting-trial claim (claim_hosting_trial_v2 gets
--                      the identities from Clerk, server-side) and, once, for accounts that
--                      already had ledger rows (record_user_identities). lib/hosting/gate.ts
--                      uses it to treat accounts sharing an identity as one person for the
--                      free hosting trial.
--
-- Accounts that got their welcome grant before this migration have no identity rows
-- until they next load the dashboard / billing page / credit balance (ensureWelcomeGrant
-- then backfills them via record_user_identities) or claim a hosting trial. Until then
-- the FIRST alias of such an account can still get one welcome grant; every later alias
-- is refused.
--
-- Until this runs the app falls back to grant_welcome_credits (per-user only) and the
-- per-user hosting_trials claim — i.e. the previous behaviour.
-- Idempotent: safe to run more than once (also over an earlier draft of this file: the
-- old two-argument claim_hosting_trial_v2 is dropped below).

-- ── Tables (service role only: RLS on, no policies) ─────────────────────────────
CREATE TABLE IF NOT EXISTS welcome_grants (
  normalized_identity text PRIMARY KEY,
  user_id             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS welcome_grants_user_idx ON welcome_grants (user_id);
ALTER TABLE welcome_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON welcome_grants FROM anon, authenticated;
COMMENT ON TABLE welcome_grants IS
  'One row per normalized identity (sha256 of email/phone) that received a welcome grant. Service role only.';

CREATE TABLE IF NOT EXISTS user_identities (
  normalized_identity text NOT NULL,
  user_id             text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (normalized_identity, user_id)
);
CREATE INDEX IF NOT EXISTS user_identities_user_idx ON user_identities (user_id);
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_identities FROM anon, authenticated;
COMMENT ON TABLE user_identities IS
  'Normalized identities (sha256 of email/phone) per Clerk user, for welcome-grant and hosting-trial dedupe. Service role only.';

-- Locking (all three functions below): identities are locked one by one, in sorted
-- order, in the shared two-key 'identity' namespace — pg_advisory_xact_lock(
-- hashtext('identity'), hashtext(<identity>)). The two-key form is a separate lock space
-- from the single-key credit_ledger user locks. Each function takes at most ONE other
-- lock, and always before its identity locks, so nobody waits for a non-identity lock
-- while holding an identity lock → no deadlock. A concurrent grant, trial claim and
-- backfill for the same alias therefore serialise.

-- ── Welcome grant v2 — once per user AND once per normalized identity ───────────
-- Lock order: the per-user ledger lock (same key as every credit_ledger write), then
-- the identity locks.
CREATE OR REPLACE FUNCTION grant_welcome_credits_v2(
  p_user_id    text,
  p_amount     integer,
  p_identities text[],
  p_reason     text DEFAULT 'welcome_grant'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids    text[];
  v_id     text;
  v_row_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_user_id LIKE 'deleted:%'
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT i ORDER BY i), '{}'::text[]) INTO v_ids
    FROM unnest(COALESCE(p_identities, '{}'::text[])) AS i
   WHERE i IS NOT NULL AND i <> '' AND length(i) <= 200;
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_identities');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id));
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext('identity'), hashtext(v_id));
  END LOOP;

  -- Remember who holds which identity even when the grant is refused below — the
  -- hosting-trial dedupe (claim_hosting_trial_v2, lib/hosting/gate.ts) relies on it.
  INSERT INTO user_identities (normalized_identity, user_id)
  SELECT i, p_user_id FROM unnest(v_ids) AS i
  ON CONFLICT DO NOTHING;

  IF EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', true, 'already_granted', true, 'balance', credit_balance_locked(p_user_id));
  END IF;

  IF EXISTS (
    SELECT 1 FROM welcome_grants
     WHERE normalized_identity = ANY (v_ids) AND user_id <> p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'identity_already_used', 'balance', 0);
  END IF;

  INSERT INTO welcome_grants (normalized_identity, user_id)
  SELECT i, p_user_id FROM unnest(v_ids) AS i
  ON CONFLICT (normalized_identity) DO NOTHING;

  -- No ledger rows for this user (checked above, under the lock) → balance 0 before.
  INSERT INTO credit_ledger (user_id, delta, reason, ref_id, balance_after)
  VALUES (p_user_id, p_amount, COALESCE(NULLIF(p_reason, ''), 'welcome_grant'), NULL, p_amount)
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('ok', true, 'balance', p_amount, 'id', v_row_id);
END;
$$;

-- ── Record identities — links accounts that never run the v2 welcome grant ──────
-- Pre-migration accounts and accounts whose first ledger row came from a purchase never
-- reach grant_welcome_credits_v2 (the app's fast path stops at "already has ledger
-- rows"), so their identities would never be recorded and their aliases would look like
-- strangers. ensureWelcomeGrant (app/api/credits/welcome-grant.ts) calls this once for
-- such an account. Takes only the identity locks.
CREATE OR REPLACE FUNCTION record_user_identities(
  p_user_id    text,
  p_identities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
  v_id  text;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_user_id LIKE 'deleted:%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT i ORDER BY i), '{}'::text[]) INTO v_ids
    FROM unnest(COALESCE(p_identities, '{}'::text[])) AS i
   WHERE i IS NOT NULL AND i <> '' AND length(i) <= 200;
  IF cardinality(v_ids) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_identities');
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext('identity'), hashtext(v_id));
  END LOOP;

  INSERT INTO user_identities (normalized_identity, user_id)
  SELECT i, p_user_id FROM unnest(v_ids) AS i
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'recorded', cardinality(v_ids));
END;
$$;

-- ── Hosting trial claim v2 — once per user AND per identity-linked group ────────
-- Same compare-and-set as claimHostingTrial's plain insert (hosting_trials PK user_id),
-- plus: refused ('used') when any OTHER user sharing a normalized identity with this one
-- already holds a hosting_trials claim or has (had) a project with hosting_trial_ends_at
-- set.
--
-- p_identities are the caller's CURRENT verified identities, derived server-side from
-- Clerk by lib/hosting/gate.ts (never taken from the request). They are recorded here,
-- under the identity locks and BEFORE the sibling check, so linkage does not depend on
-- the welcome grant having run (an alias can reach Push to Live via POST /api/projects →
-- /api/manifest/save → /api/deploy without ever calling /api/credits/balance). They are
-- unioned with the identities already stored for the user (an email since removed from
-- Clerk still links). An account with NO verified identity at all gets no free trial
-- ('used', reason 'unverified') — it could not be linked to its other accounts.
--
-- Lock order: the per-user hosting_trials lock, then the identity locks.
-- Returns { ok, status: 'claimed' | 'used', reason? }.
DROP FUNCTION IF EXISTS claim_hosting_trial_v2(text, uuid);

CREATE OR REPLACE FUNCTION claim_hosting_trial_v2(
  p_user_id    text,
  p_project_id uuid,
  p_identities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new      text[];
  v_ids      text[];
  v_id       text;
  v_siblings text[];
  v_existing uuid;
  v_has_row  boolean;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR p_user_id LIKE 'deleted:%' OR p_project_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT i ORDER BY i), '{}'::text[]) INTO v_new
    FROM unnest(COALESCE(p_identities, '{}'::text[])) AS i
   WHERE i IS NOT NULL AND i <> '' AND length(i) <= 200;
  IF cardinality(v_new) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_identities');
  END IF;

  -- Everything this user is known by: the fresh Clerk set + what was stored earlier.
  SELECT COALESCE(array_agg(DISTINCT u.i ORDER BY u.i), '{}'::text[]) INTO v_ids
    FROM (
      SELECT unnest(v_new) AS i
      UNION
      SELECT s.normalized_identity FROM (
        SELECT normalized_identity FROM user_identities
         WHERE user_id = p_user_id
         ORDER BY created_at
         LIMIT 50
      ) s
    ) u;

  PERFORM pg_advisory_xact_lock(hashtext('hosting_trials'), hashtext(p_user_id));
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtext('identity'), hashtext(v_id));
  END LOOP;

  -- Record before the sibling check (and even when refused below), so a LATER alias of
  -- this person is linked to this account too.
  INSERT INTO user_identities (normalized_identity, user_id)
  SELECT i, p_user_id FROM unnest(v_new) AS i
  ON CONFLICT DO NOTHING;

  -- Our own claim first: a claim for this same project is ours (a concurrent Push to
  -- Live of it took it), one for another project means the trial is used.
  SELECT true, project_id INTO v_has_row, v_existing
    FROM hosting_trials WHERE user_id = p_user_id;
  IF v_has_row THEN
    RETURN jsonb_build_object('ok', true,
      'status', CASE WHEN v_existing = p_project_id THEN 'claimed' ELSE 'used' END);
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'status', 'used', 'reason', 'unverified');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT user_id), '{}'::text[]) INTO v_siblings
    FROM user_identities
   WHERE normalized_identity = ANY (v_ids) AND user_id <> p_user_id;

  IF cardinality(v_siblings) > 0 AND (
    EXISTS (SELECT 1 FROM hosting_trials WHERE user_id = ANY (v_siblings))
    OR EXISTS (
      SELECT 1 FROM projects
       WHERE hosting_trial_ends_at IS NOT NULL
         AND (user_id = ANY (v_siblings)
              OR user_id = ANY (ARRAY(SELECT 'deleted:' || s FROM unnest(v_siblings) AS s)))
    )
  ) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'used', 'reason', 'identity');
  END IF;

  INSERT INTO hosting_trials (user_id, project_id) VALUES (p_user_id, p_project_id)
  ON CONFLICT (user_id) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'status', 'claimed');
  END IF;

  SELECT project_id INTO v_existing FROM hosting_trials WHERE user_id = p_user_id;
  RETURN jsonb_build_object('ok', true,
    'status', CASE WHEN v_existing = p_project_id THEN 'claimed' ELSE 'used' END);
END;
$$;

-- ── Only the service role may execute these ─────────────────────────────────────
REVOKE ALL ON FUNCTION grant_welcome_credits_v2(text, integer, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_user_identities(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_hosting_trial_v2(text, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION grant_welcome_credits_v2(text, integer, text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION record_user_identities(text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION claim_hosting_trial_v2(text, uuid, text[]) TO service_role;

-- Verification:
--   SELECT proname, pg_get_function_identity_arguments(oid), proacl FROM pg_proc
--    WHERE proname IN ('grant_welcome_credits_v2', 'record_user_identities', 'claim_hosting_trial_v2');
--   -- exactly one row each (claim_hosting_trial_v2 with 3 arguments); proacl must NOT
--   -- contain '=X/' (PUBLIC) or 'anon=' / 'authenticated='.
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('welcome_grants', 'user_identities');
--   -- relrowsecurity must be true.
