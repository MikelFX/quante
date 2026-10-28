-- Qscan (2026-10-28). Idempotent; safe to re-run. Run manually in the Supabase SQL Editor.
-- Until it has run, /qscan says the scanner is not set up and copies nothing.
--
-- qscan_scans  one scan of an existing store (POST /api/qscan): the address, what was found,
--              the generation brief built from it and how much was copied into the public
--              store-assets bucket (<user_id>/qscan-<id>/). Counting these rows is the daily
--              scan cap, which bounds how much one account can copy into our storage.
--
-- Service role only (the route uses supabaseAdmin). No policies on purpose: anon/authenticated
-- must not read or write these rows.

CREATE TABLE IF NOT EXISTS qscan_scans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,                                   -- Clerk user id
  created_at  timestamptz NOT NULL DEFAULT now(),
  url         text NOT NULL CHECK (char_length(url) <= 2048),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  platform    text,
  summary     jsonb,                                           -- what the page shows (brand, counts, products preview)
  brief       text,                                            -- the generation brief built from the scan
  bytes       bigint NOT NULL DEFAULT 0,                       -- copied into store-assets
  error       text
);

CREATE INDEX IF NOT EXISTS qscan_scans_user_idx ON qscan_scans (user_id, created_at DESC);

ALTER TABLE qscan_scans ENABLE ROW LEVEL SECURITY;

-- Check:
--   SELECT count(*) FROM qscan_scans;
