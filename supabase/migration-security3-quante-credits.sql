-- Security pass 3 — quante-credits group (re-audit R2 + R6, 2026-09-23).
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor AFTER
-- migration-security-iterate-fix-section.sql. Idempotent.
--
-- R2: /api/credits/refund treated the auto-fix loop as "exhausted" by counting every
-- quante_request_attempts row with route 'fix' — including requests that /api/quante/fix
-- refused with 429/409/413/503 before Claude was ever called. Exhaustion is now counted in
-- SAVED fix versions whose builds failed (code only), and /api/quante/fix sets executed_at
-- only after every cap and the failed-build check passed (right before the Claude call);
-- the refund route links each fix version to an executed attempt.
--   Until this runs: the fix route still works (marking just logs an error), and the
--   refund route falls back to all fix attempts for that link (logged).
--   Chains whose attempts were made BEFORE this ran have executed_at null and are not
--   refundable once it has run (only matters inside the 2h refund window around it).
--
-- R6: /api/quante/intake (free Claude chat) now uses the same attempt log for DB-backed
-- per-user hourly + daily and per-IP hourly limits + an in-flight cap (route 'intake').
-- The per-IP count needs the ip column.
--   Until this runs: intake rows are recorded without ip, so the per-user DB limits work
--   and the per-IP limit stays in-memory only.

ALTER TABLE quante_request_attempts ADD COLUMN IF NOT EXISTS executed_at timestamptz;
ALTER TABLE quante_request_attempts ADD COLUMN IF NOT EXISTS ip text;

-- route now also takes 'intake' (no CHECK constraint exists on it; documented only).
COMMENT ON COLUMN quante_request_attempts.route IS '''iterate'' | ''fix'' | ''intake''';
COMMENT ON COLUMN quante_request_attempts.executed_at IS
  'Set when the request passed every cap and the model was actually called (fix: counted by /api/credits/refund).';
COMMENT ON COLUMN quante_request_attempts.ip IS 'Client IP (intake per-IP rate limit). Personal data — purge old rows.';

-- Per-IP hourly count for intake.
CREATE INDEX IF NOT EXISTS quante_request_attempts_ip_route_idx
  ON quante_request_attempts (ip, route, created_at DESC)
  WHERE ip IS NOT NULL;

-- Housekeeping is now recommended (rows hold IPs and are only needed for ~1 day):
--   DELETE FROM quante_request_attempts WHERE created_at < now() - interval '7 days';
