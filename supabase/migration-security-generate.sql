-- Capped-refund claims (security audit 2026-09-23, group "generate").
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor. Idempotent.
--
-- Why: refunds for failures the user can provoke on purpose (a brief crafted so the
-- model output is unusable, a store whose build never passes auto-fix) are capped per
-- user per day. The cap used to count credit_ledger rows with reason
-- 'generation_failed' — but that reason is also written by uncapped infrastructure
-- refunds, by racing generate requests that back out, and by iterate's own failure
-- refunds, so a few outages exhausted a legitimate user's cap. A separate reason
-- string is NOT an option: refund_debit() is idempotent per refund reason, so two
-- reasons on one debit ref could refund it twice.
--
-- Each capped refund now reserves one row here (keyed by the debit's ref) BEFORE the
-- refund, counts the user's rows in the last 24h (own row included, so concurrent
-- requests can't all slip under the cap), and deletes its row again if the cap is
-- exceeded or nothing was refunded.
--
-- Used by app/api/credits/refund/capped.ts (/api/credits/refund and the capped refunds
-- in /api/quante/generate). Until this table exists those fall back to the old, stricter
-- ledger-based count.

CREATE TABLE IF NOT EXISTS credit_refund_claims (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  debit_ref   uuid NOT NULL,             -- ref_id of the refunded debit (job id / version id)
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_refund_claims_user_ref_key UNIQUE (user_id, debit_ref)
);

CREATE INDEX IF NOT EXISTS credit_refund_claims_user_created_idx
  ON credit_refund_claims (user_id, created_at DESC);

-- Service role only (routes use supabaseAdmin). No policies on purpose: clients must
-- not be able to read, forge or delete claims.
ALTER TABLE credit_refund_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON credit_refund_claims FROM anon, authenticated;

-- Optional housekeeping (rows are only needed for ~1 day):
--   DELETE FROM credit_refund_claims WHERE created_at < now() - interval '7 days';
