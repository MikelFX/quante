-- Qbox open to every agent, paid only (2026-11-05). Idempotent; safe to re-run. Run manually in the
-- Supabase SQL Editor AFTER migration-qbox-beta.sql, and before setting QBOX_ACCESS=open.
-- Until it has run, the paid tier answers "not set up" and starts nothing (the invite-only beta keeps working).
--
-- qbox_sandboxes.vcpus   size of each sandbox (billing and the daily budget count vCPU-minutes)
-- qbox_sandboxes.billed  true = counted against the account's prepaid balance
-- qbox_topups            the prepaid balance, in vCPU-minutes: top-ups (credits, x402) are positive,
--                        per-operation charges negative. ref is unique, so a payment is booked once.
-- qbox_agents            accounts an agent opened itself by paying (user_id 'agent_…', no Clerk login)
--
-- Service role only (routes use supabaseAdmin). No policies on purpose.

ALTER TABLE qbox_sandboxes ADD COLUMN IF NOT EXISTS vcpus int CHECK (vcpus BETWEEN 1 AND 32);
ALTER TABLE qbox_sandboxes ADD COLUMN IF NOT EXISTS billed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS qbox_sandboxes_billed_idx ON qbox_sandboxes (user_id) WHERE billed;
CREATE INDEX IF NOT EXISTS qbox_sandboxes_day_idx ON qbox_sandboxes (created_at);

CREATE TABLE IF NOT EXISTS qbox_topups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  vcpu_minutes  numeric(14, 2) NOT NULL,
  source        text NOT NULL CHECK (source IN ('credits', 'x402', 'charge', 'grant', 'refund')),
  credits       int,
  usd_cents     int,
  ref           text UNIQUE,
  note          text CHECK (char_length(note) <= 300)
);
CREATE INDEX IF NOT EXISTS qbox_topups_user_idx ON qbox_topups (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qbox_agents (
  user_id     text PRIMARY KEY CHECK (user_id LIKE 'agent\_%'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  payer       text,          -- the wallet that paid first (x402)
  network     text,
  name        text CHECK (char_length(name) <= 60)
);

ALTER TABLE qbox_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_agents ENABLE ROW LEVEL SECURITY;

-- Balance of one account (vCPU-minutes), same rule as paidBalance() in lib/qbox/model.ts:
--   SELECT coalesce((SELECT sum(vcpu_minutes) FROM qbox_topups WHERE user_id = 'agent_…'), 0);
-- Money in by source this month:
--   SELECT source, count(*), sum(usd_cents) / 100.0 AS usd, sum(credits) AS credits
--   FROM qbox_topups WHERE created_at >= date_trunc('month', now()) AND vcpu_minutes > 0 GROUP BY source;
