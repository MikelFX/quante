-- Automatic store scaffold rollout (2026-09-24). Idempotent; safe to re-run.
-- NOT RUN AGAINST PRODUCTION. Run it in the Supabase SQL Editor BEFORE (or together
-- with) deploying the code that uses it. The app keeps working without it:
-- lib/hosting/deployments.ts retries deployments inserts without the new columns, and
-- the rollout (lib/hosting/scaffold-rollout.ts, /api/cron/scaffold-rollout,
-- Admin → Store updates, the Studio "store update" banner) stays switched off
-- (reason 'migration_pending') until these columns exist.
--
-- deployments.target           what the build is: 'production' (Push to Live and every
--                              production-target auto-deploy / restore / rollout),
--                              'preview' (true Vercel preview, no subdomain) or
--                              'maintenance' (hosting-cron maintenance page). NULL on
--                              rows written before this migration.
-- deployments.scaffold_version SCAFFOLD_VERSION (lib/store-template/build.ts) the build
--                              was made with; NULL = before versioning = version 1.
--                              NULL for maintenance pages.
-- deployments.rollout_trigger  'admin' | 'cron' | 'owner' on scaffold rollout builds,
--                              NULL on every other build (Push to Live, chat edits,
--                              fixes, restore, previews, maintenance). The auto-fix and
--                              credit-refund "latest failed build" checks ignore rollout
--                              builds, and only rollout failures are recorded as
--                              projects.scaffold_update_error.
-- projects.scaffold_version    scaffold version of the store's live production build,
--                              written when a production build at that version is seen
--                              READY (rollout bookkeeping; the deployments rows decide).
-- projects.scaffold_update_*   rollout bookkeeping: attempts since the last success
--                              (the cron / admin batch skip a store at >= 3), last error
--                              (Vercel build log excerpt), last attempt time (also a
--                              short per-project lock against concurrent triggers).

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS scaffold_version int;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS rollout_trigger text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deployments_target_check'
  ) THEN
    ALTER TABLE deployments
      ADD CONSTRAINT deployments_target_check
      CHECK (target IS NULL OR target IN ('production', 'preview', 'maintenance'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deployments_rollout_trigger_check'
  ) THEN
    ALTER TABLE deployments
      ADD CONSTRAINT deployments_rollout_trigger_check
      CHECK (rollout_trigger IS NULL OR rollout_trigger IN ('admin', 'cron', 'owner'));
  END IF;
END $$;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS scaffold_version int;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scaffold_update_attempts int NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scaffold_update_error text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scaffold_update_at timestamptz;

-- "Newest production deployment of a project" (rollout, live-version lookup).
CREATE INDEX IF NOT EXISTS deployments_project_target_created_idx
  ON deployments (project_id, target, created_at DESC);

-- reconcileRolloutDeployments(): recent production builds still building/queued.
CREATE INDEX IF NOT EXISTS deployments_rollout_pending_idx
  ON deployments (created_at DESC)
  WHERE target = 'production' AND status IN ('building', 'queued');

-- reconcileRolloutDeployments(): recent production builds settled elsewhere.
CREATE INDEX IF NOT EXISTS deployments_production_recent_idx
  ON deployments (created_at DESC)
  WHERE target = 'production';

-- findOutdatedStores(): live, not suspended, has a Vercel project.
CREATE INDEX IF NOT EXISTS projects_live_scaffold_idx
  ON projects (id)
  WHERE hosting_trial_ends_at IS NOT NULL
    AND hosting_suspended_at IS NULL
    AND vercel_project_id IS NOT NULL;

-- Make PostgREST see the new columns immediately.
NOTIFY pgrst, 'reload schema';
