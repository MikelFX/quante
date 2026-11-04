-- Qbox closed beta (2026-11-04). Idempotent; safe to re-run. Run manually in the Supabase SQL Editor.
-- Until it has run, /qbox and /api/qbox/* say the beta is not set up and start nothing.
--
-- qbox_beta       invited accounts (the operator adds rows). Optional per-member limits.
-- qbox_waitlist   "request access" from /qbox (one row per account).
-- qbox_api_keys   API keys: only the sha256 hash and a short prefix are stored.
-- qbox_sandboxes  every sandbox started through the API: owner, lifetime, ports. Counting these
--                 rows is the concurrency + monthly-minute cap that protects the operator's bill.
--
-- Service role only (routes use supabaseAdmin). No policies on purpose.

CREATE TABLE IF NOT EXISTS qbox_beta (
  user_id          text PRIMARY KEY,                                  -- Clerk user id
  created_at       timestamptz NOT NULL DEFAULT now(),
  note             text,
  max_concurrent   int CHECK (max_concurrent BETWEEN 1 AND 50),       -- null = default (2)
  monthly_minutes  int CHECK (monthly_minutes BETWEEN 1 AND 100000),  -- null = default (600)
  disabled         boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS qbox_waitlist (
  user_id     text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  email       text,
  use_case    text CHECK (char_length(use_case) <= 1000)
);

CREATE TABLE IF NOT EXISTS qbox_api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  name          text NOT NULL CHECK (char_length(name) <= 60),
  key_hash      text NOT NULL UNIQUE,
  prefix        text NOT NULL,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS qbox_api_keys_user_idx ON qbox_api_keys (user_id);

CREATE TABLE IF NOT EXISTS qbox_sandboxes (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL,
  key_id      uuid REFERENCES qbox_api_keys(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'stopped', 'failed')),
  engine      text NOT NULL DEFAULT 'vercel',
  template    text NOT NULL,
  ports       int[],
  metadata    jsonb,
  error       text
);
CREATE INDEX IF NOT EXISTS qbox_sandboxes_user_idx ON qbox_sandboxes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qbox_sandboxes_live_idx ON qbox_sandboxes (expires_at) WHERE status = 'running';

ALTER TABLE qbox_beta ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbox_sandboxes ENABLE ROW LEVEL SECURITY;

-- Invite someone (their Clerk user id, e.g. from the waitlist):
--   INSERT INTO qbox_beta (user_id, note) VALUES ('user_…', 'beta') ON CONFLICT DO NOTHING;
-- Waitlist:
--   SELECT * FROM qbox_waitlist ORDER BY created_at;
-- Usage this month:
--   SELECT user_id, count(*), round(sum(extract(epoch FROM (least(coalesce(ended_at, now()), expires_at, now()) - created_at)) / 60)) AS minutes
--   FROM qbox_sandboxes WHERE created_at >= date_trunc('month', now()) GROUP BY user_id;
