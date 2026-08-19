-- Add deploy_error column to generation_jobs.
-- Separate from `error` (which means "generation itself failed, no code saved").
-- deploy_error means "code IS saved, but the follow-up preview deploy call was rejected
-- by Vercel" — a distinct failure mode that needs distinct UI (2026-08-19 fix).
--
-- Backend read/write is defensive: the API route retries without this column if the
-- schema hasn't been migrated yet, so applying this migration is a strict upgrade
-- (nothing regresses if you delay). See app/api/quante/generate/route.ts and
-- app/api/quante/generate/status/route.ts.

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS deploy_error text;

-- Verification query — run after applying:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'generation_jobs' AND column_name = 'deploy_error';
-- should return one row.
