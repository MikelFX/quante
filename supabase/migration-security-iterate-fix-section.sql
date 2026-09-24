-- Request-attempt log for paid / free Claude routes (security audit 2026-09-23).
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor. Idempotent.
--
-- Why: the old per-minute / per-hour limits counted rows that are only written AFTER
-- the Claude call finishes (code_versions, credit_ledger), so N parallel requests all
-- saw count 0 and passed. /api/quante/iterate (agency tier, which pays no credits) and
-- /api/quante/fix (free) now insert an attempt row BEFORE calling Claude and count:
--   - attempts in the last minute (agency per-minute limit),
--   - in-flight attempts (finished_at IS NULL, recent) → concurrency cap,
--   - attempts per failed deployment (ref_id) → free auto-fix cap,
--   - rolling hourly / daily attempts per user (agency iterate, free fix).
-- The k-th concurrent insert always sees >= k rows, so at most `limit` requests pass.
--
-- REQUIRED by app/api/quante/iterate/attempts.ts. Agency iterate and /api/quante/fix
-- fail closed (refuse the request) until this table exists.

CREATE TABLE IF NOT EXISTS quante_request_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  route       text NOT NULL,            -- 'iterate' | 'fix'
  ref_id      uuid,                     -- iterate: project id; fix: deployments.id
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS quante_request_attempts_user_route_idx
  ON quante_request_attempts (user_id, route, created_at DESC);
CREATE INDEX IF NOT EXISTS quante_request_attempts_ref_idx
  ON quante_request_attempts (ref_id, route);

-- Service role only (server routes use supabaseAdmin, which bypasses RLS). No policies
-- on purpose: anon/authenticated must not be able to read or forge attempt rows.
ALTER TABLE quante_request_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quante_request_attempts FROM anon, authenticated;

-- Optional housekeeping (rows are only needed for ~1 day):
--   DELETE FROM quante_request_attempts WHERE created_at < now() - interval '7 days';
