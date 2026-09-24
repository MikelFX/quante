-- Security pass 3 — group webhook-secrets-qads (R3 / R4). Idempotent; safe to re-run.
-- Run in the Supabase SQL Editor after migration-security-stripe-payments.sql.
--
-- R3: a charged-back hosting invoice is marked on its hosting_subscriptions row, so
-- the Stripe webhook knows a hosting dispute is still open before it lifts an account's
-- billing_hold. The column is never sent by the subscription upsert in the webhook, so
-- later customer.subscription.* events don't clear it; only a won dispute does.
-- Until this runs, the webhook still cancels the subscription and ends the trial (the
-- authoritative marker is billing_disputes below; this column is informational).
-- DEPLOY ORDER: run this file BEFORE deploying the webhook change.
ALTER TABLE hosting_subscriptions ADD COLUMN IF NOT EXISTS disputed_at timestamptz;

CREATE INDEX IF NOT EXISTS hosting_subscriptions_disputed_idx
  ON hosting_subscriptions (user_id) WHERE disputed_at IS NOT NULL;

-- R3: user_domains.status gains the value 'disputed' (charged-back domain purchase:
-- detached from Vercel, protection canceled). The column is plain text with no CHECK
-- constraint, so no DDL is needed; status values are now
--   pending | registering | active | failed | expired | disputed
CREATE INDEX IF NOT EXISTS user_domains_disputed_idx
  ON user_domains (user_id) WHERE status = 'disputed';

-- R3 follow-up: user_domains.status is also written by the owner's own routes
-- (DELETE soft-deletes to 'expired', connect sets 'pending'/'active'), so it can't be
-- what keeps an account on billing_hold. Every chargeback on a domain purchase, hosting,
-- domain-protection or Agency invoice is recorded here, keyed by the Stripe dispute id,
-- with its CURRENT state (open = funds withdrawn, lost = final, resolved = won or an
-- inquiry that took no money). Only the Stripe webhook (service role) writes it; the
-- webhook keeps billing_hold while any row for the user is open or lost, and — until
-- this table exists — never lifts a hold at all (fails closed) and returns 500 on a
-- withdrawn non-credit dispute so Stripe retries it after the migration has run.
CREATE TABLE IF NOT EXISTS billing_disputes (
  dispute_id  text PRIMARY KEY,                 -- Stripe dispute id (du_...)
  user_id     text NOT NULL,                    -- Clerk user id
  kind        text NOT NULL
                CHECK (kind IN ('domain_purchase', 'hosting', 'domain_protection', 'agency')),
  ref_id      text,                             -- user_domains.id or Stripe subscription id
  status      text NOT NULL CHECK (status IN ('open', 'lost', 'resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_disputes_outstanding_idx
  ON billing_disputes (user_id) WHERE status IN ('open', 'lost');

-- RLS on, no policies: only the service role (the webhook) can read or write it.
ALTER TABLE billing_disputes ENABLE ROW LEVEL SECURITY;

-- R4: users.billing_hold is now set with an upsert (INSERT ... ON CONFLICT (id) DO
-- UPDATE SET billing_hold), so credit-tier accounts without a public.users row get a
-- row with the column defaults (tier 'free', project_limit 3) plus billing_hold = true.
-- users.id is already the primary key; nothing to change here.
