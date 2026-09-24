-- migration-security-stripe-payments.sql — security audit 2026-09-23 (stripe-payments group)
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor, AFTER
-- migration-credits-v2.sql. Idempotent: safe to run more than once.
--
-- Covers:
--   #31/#80  purchases: payment-intent link + clawback bookkeeping for refunds/chargebacks
--   #9/#8    store_earnings: payment-intent link + adjustment kind (negative refund/dispute rows)
--   #9       store_payout_accounts: IBAN-change cool-down + operator identity verification
--   #28      payout_requests: at most ONE open request per project + currency, and a review
--            query for open requests created by the old (inflated) balance code
--   #32/#68  user_domains: purchase-keyed idempotency; pending_domain_purchases failure reason
--   #14      project_secrets.payment_test_mode defaults to OFF for new rows
--
-- The app code tolerates these columns being absent (it retries without them and logs a
-- warning), but refund matching, payout race protection and domain idempotency are only
-- complete once this has been applied.

-- ── #31 / #80 purchases ─────────────────────────────────────────────────────────
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stripe_customer_id text;
-- Credits already reversed for this purchase (clawed back + shortfall), so a retried
-- charge.refunded / dispute event never claws back twice.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refunded_credits integer NOT NULL DEFAULT 0;
-- Credits that SHOULD have been clawed back but the user had already spent. Non-zero =
-- the account needs manual review (it received paid work it did not pay for).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS clawback_shortfall integer NOT NULL DEFAULT 0;
-- paid | refunded | partially_refunded | disputed | dispute_won | dispute_lost
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid';
-- The part of refunded_credits that a chargeback reversed, so a won dispute (or a closed
-- inquiry) restores exactly that slice, once (compare-and-set on status).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS chargeback_credits integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS purchases_payment_intent_idx
  ON purchases (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- Chargeback flag (set by the webhook). NOTE: paid routes do not check it yet — wiring
-- `billing_hold` into generate/iterate/export/qads/deploy is a follow-up.
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_hold boolean NOT NULL DEFAULT false;

-- ── #9 / #8 store_earnings ──────────────────────────────────────────────────────
ALTER TABLE store_earnings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
-- sale | refund | dispute. Refund/dispute rows carry NEGATIVE amounts and a synthetic
-- stripe_session_id ('refund:<charge id>' / 'dispute:<dispute id>') for idempotency.
ALTER TABLE store_earnings ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sale';
CREATE INDEX IF NOT EXISTS store_earnings_payment_intent_idx
  ON store_earnings (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ── #9 store_payout_accounts: cool-down + identity verification ─────────────────
-- iban_changed_at: set by /api/payout/account whenever the IBAN or holder changes;
-- /api/payout/request refuses payouts for PAYOUT_IBAN_COOLDOWN_DAYS (default 7) after it.
ALTER TABLE store_payout_accounts ADD COLUMN IF NOT EXISTS iban_changed_at timestamptz;
-- identity_verified_at: set ONLY by an operator after checking that the account holder
-- is the (KYC-checked) store owner. Cleared automatically when the IBAN/holder changes.
-- Payout requests are refused while it is NULL — existing accounts start unverified.
--   UPDATE store_payout_accounts SET identity_verified_at = now()
--    WHERE project_id = '<project uuid>';   -- only after verifying the holder's identity
ALTER TABLE store_payout_accounts ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;

-- ── #28 payout_requests: one open request per project + currency ────────────────
-- If this fails with "could not create unique index", there are already several open
-- requests for one project/currency (the race this closes). Review them first:
--   SELECT project_id, currency, array_agg(id), sum(amount_cents)
--     FROM payout_requests WHERE status IN ('pending','processing')
--    GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_one_open_per_project_currency
  ON payout_requests (project_id, currency)
  WHERE status IN ('pending', 'processing');

-- IMPORTANT (#8/#28): open requests created BEFORE this fix were sized by the old code,
-- which summed net_amount_cents across currencies (CZK + EUR + IDR … as "€"), ignored
-- refunds/disputes and had no hold period — they can be massively inflated, and they
-- never went through identity verification. Do NOT pay any existing pending/processing
-- request until it has been recomputed against the new per-currency settled balance
-- (same rules as lib/payments/earnings.ts getPayoutBalances; 90 = PAYOUT_HOLD_DAYS):
--   WITH settled AS (
--     SELECT project_id, lower(coalesce(currency, 'eur')) AS currency,
--            sum(net_amount_cents) FILTER (
--              WHERE net_amount_cents <= 0 OR created_at <= now() - interval '90 days'
--            ) AS settled_net
--       FROM store_earnings GROUP BY 1, 2
--   ), paid AS (
--     SELECT project_id, lower(currency) AS currency, sum(amount_cents) AS paid
--       FROM payout_requests WHERE status = 'paid' GROUP BY 1, 2
--   )
--   SELECT r.id, r.project_id, r.currency, r.amount_cents AS requested, r.status, r.created_at,
--          coalesce(s.settled_net, 0) - coalesce(p.paid, 0) AS payable_now
--     FROM payout_requests r
--     LEFT JOIN settled s ON s.project_id = r.project_id AND s.currency = lower(r.currency)
--     LEFT JOIN paid    p ON p.project_id = r.project_id AND p.currency = lower(r.currency)
--    WHERE r.status IN ('pending', 'processing')
--    ORDER BY r.amount_cents - (coalesce(s.settled_net, 0) - coalesce(p.paid, 0)) DESC;
-- Any row where requested > payable_now (summed per project + currency) must be reduced
-- or rejected (status 'rejected' + a note) before payment; verify the holder's identity
-- for the rest as described above.

-- ── #32 / #68 domains ───────────────────────────────────────────────────────────
ALTER TABLE user_domains ADD COLUMN IF NOT EXISTS stripe_session_id text;
CREATE UNIQUE INDEX IF NOT EXISTS user_domains_stripe_session_id_idx
  ON user_domains (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
-- Protection is only true once a paid protection subscription exists.
ALTER TABLE user_domains ALTER COLUMN protection_enabled SET DEFAULT false;

ALTER TABLE pending_domain_purchases ADD COLUMN IF NOT EXISTS failure_reason text;
-- When the webhook claimed the row. A 'processing' row older than 5 minutes with no
-- user_domains row for its session is a crashed delivery and is re-claimed by the retry.
ALTER TABLE pending_domain_purchases ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
-- status values now: pending | processing | consumed | failed_refunded | failed | expired
-- ('expired' + a completed payment → automatic refund; 'failed' = refund needs a human)

-- ── #14 payment gateways: test mode OFF by default ──────────────────────────────
ALTER TABLE project_secrets ALTER COLUMN payment_test_mode SET DEFAULT false;
-- Existing rows keep their current value (most are still `true` from the old default).
-- While true, gateway payments run in sandbox and notifications only ever set
-- payment_status = 'test_paid' (never 'paid'). Decide per merchant before flipping:
--   UPDATE project_secrets SET payment_test_mode = false
--    WHERE payment_test_mode = true AND <merchant confirmed live credentials>;
