-- Agency batch generation (2026-10-10): up to 20 stores from one request.
-- Run once in the Supabase SQL editor BEFORE deploying the code that uses it. Idempotent.
--
-- A batch is the set of generation_jobs rows that share batch_id — no separate table. Rows of
-- a batch start with status 'queued' (the status column has no CHECK constraint, so the new
-- value needs no change here); lib/generation/batch.ts moves a few at a time to 'running' and
-- runs each through the same pipeline as a single generation (lib/generation/run.ts).
-- project_name carries the store name the merchant gave the row (a single generation passes
-- it in memory); batch_index keeps the order of the list. Until this runs, POST /api/quante/batch answers 503 and nothing else changes.

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS project_name text;
-- Position in the merchant's list (created_at restarts when a queued row is started).
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS batch_index smallint;

CREATE INDEX IF NOT EXISTS generation_jobs_batch_idx
  ON generation_jobs (batch_id, batch_index)
  WHERE batch_id IS NOT NULL;

-- Check:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'generation_jobs'
--     AND column_name IN ('batch_id', 'project_name', 'batch_index');
