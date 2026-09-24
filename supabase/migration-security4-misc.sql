-- Security pass 4 — group misc (audit F1 / F6 / F11). Idempotent; safe to re-run.
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL Editor.
--
-- F6/F11: per-user daily upload quota for /api/upload (store-assets) and
-- /api/qads/upload (qads-inputs). Each upload inserts a row here BEFORE the file is
-- written and then counts / sums this user's rows for the bucket over the last 24h
-- (including its own), so concurrent uploads can't all slip past the cap. A refused or
-- failed upload deletes its own row. Used by app/api/upload/_lib/quota.ts.
-- Until this table exists both routes fall back to counting today's objects already in
-- storage under the user's prefix (weaker, not race-safe) — so run this soon.
CREATE TABLE IF NOT EXISTS upload_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,                    -- Clerk user id
  bucket      text NOT NULL,                    -- 'store-assets' | 'qads-inputs'
  bytes       bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_events_user_bucket_idx
  ON upload_events (user_id, bucket, created_at DESC);

-- Service role only (server routes use supabaseAdmin, which bypasses RLS). No policies
-- on purpose: anon/authenticated must not be able to read or forge quota rows.
ALTER TABLE upload_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON upload_events FROM anon, authenticated;

-- Optional housekeeping (rows are only needed for 24h):
--   DELETE FROM upload_events WHERE created_at < now() - interval '7 days';

-- F1: /api/projects/[id]/insights now records every analysis attempt in
-- quante_request_attempts (route 'insights', ref_id = project id) before calling
-- Claude. The route column has no CHECK constraint, so no DDL is needed; this only
-- documents the new value. Requires migration-security-iterate-fix-section.sql (until
-- that table exists the insights route keeps only its per-user ledger cap).
DO $$
BEGIN
  IF to_regclass('public.quante_request_attempts') IS NOT NULL THEN
    COMMENT ON COLUMN quante_request_attempts.route IS '''iterate'' | ''fix'' | ''intake'' | ''insights''';
  END IF;
END $$;
