-- AI file safety filter reporting (security audit 2026-09-23, second pass, group "gen-pipeline").
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor. Idempotent.
--
-- /api/quante/generate now drops every AI-produced file that fails
-- filterAiStoreFiles() (lib/store-template/build.ts: path allowlist + forbidden
-- server-side code) before saving code_versions or deploying (audit #23). The dropped
-- paths and reasons are stored on the job so GET /api/quante/generate/status can return
-- them as `droppedFiles` / `droppedFileDetails`.
--
-- Shape: [{ "path": "app/api/x/route.ts", "reason": "path not allowed" }, ...]
-- (at most 50 entries, paths capped at 200 chars — see normalizeDroppedFiles in
-- lib/generation-checkpoint.ts).
--
-- Until this runs, the writer logs a non-fatal error and the status route falls back
-- to selecting without the column (droppedFiles is then always []).

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS dropped_files jsonb NOT NULL DEFAULT '[]'::jsonb;
