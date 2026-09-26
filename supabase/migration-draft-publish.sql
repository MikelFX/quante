-- Draft / publish for code-gen stores (2026-09-26). Idempotent; safe to re-run.
-- Run in the Supabase SQL Editor BEFORE (or together with) deploying the code that uses
-- it. Until it has run, chat edits / auto-fixes of live stores keep deploying straight to
-- production (the old behaviour) and the Studio "Publish" button falls back to a full
-- production build (Push to Live).
--
-- deployments.target 'staged'  a production-target Vercel build created with
--                              autoAssignCustomDomains=false: it runs with the store's
--                              production env vars but does NOT serve the store's domains.
--                              Every chat edit / auto-fix / rebuild of a live store is a
--                              staged build (the Studio previews its raw *.vercel.app URL).
--                              "Publish" promotes it (Vercel promote API, no rebuild) and
--                              flips the row to target 'production'.
-- deployments.promoted_at      when a staged build was promoted. The live build is the
--                              ready production row with the newest
--                              coalesce(promoted_at, created_at) — a promoted build can be
--                              older than production builds that finished before it went
--                              live (lib/hosting/scaffold-rollout-rules.ts liveSinceMs).

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_target_check;
ALTER TABLE deployments
  ADD CONSTRAINT deployments_target_check
  CHECK (target IS NULL OR target IN ('production', 'preview', 'maintenance', 'staged'));

-- Publish: newest staged build of a code version.
CREATE INDEX IF NOT EXISTS deployments_staged_version_idx
  ON deployments (code_version_id, created_at DESC)
  WHERE target = 'staged';

NOTIFY pgrst, 'reload schema';
