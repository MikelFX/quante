-- migration-security3-hosting.sql — security re-audit 2026-09, group "hosting" (R7)
--
-- The 30-day free hosting trial is once per USER, not per project. /api/deploy used to
-- decide that with a read ("does this user have another project with
-- hosting_trial_ends_at set?") followed by a per-project stamp, so N parallel first
-- deploys on N different projects could each pass the read and each get a trial.
--
-- hosting_trials holds at most one row per user (PRIMARY KEY user_id). /api/deploy
-- inserts it (claimHostingTrial in lib/hosting/gate.ts) before stamping the project;
-- only the insert that wins gets the 30 days, the others get a unique violation and are
-- stamped "now" (subscription / Agency) or refused (402 SUBSCRIPTION_REQUIRED).
-- When a first live deploy never produces a store (the Vercel deployment could not be
-- created, or its build failed), /api/deploy clears the project's stamp and deletes this
-- project's claim again (releaseHostingTrial), so the user keeps their trial.
--
-- user_id is the Clerk user id (never the 'deleted:<id>' tombstone form). project_id has
-- no foreign key on purpose: a claim must outlive its project, or deleting the project
-- would hand the trial back.
--
-- Until this runs: claimHostingTrial reports the table as missing and /api/deploy falls
-- back to the old read-only re-check (works, but the parallel-deploy race stays open).
-- Idempotent: safe to run more than once. File only — review before running.

CREATE TABLE IF NOT EXISTS hosting_trials (
  user_id    text PRIMARY KEY,
  project_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE hosting_trials IS
  'One row per user who has taken the free 30-day hosting trial (audit R7). Service role only.';

-- Service-role only: RLS on, no policies.
ALTER TABLE hosting_trials ENABLE ROW LEVEL SECURITY;

-- Backfill: every user who already has (or had — soft-deleted projects are tombstoned as
-- user_id 'deleted:<id>') a project with hosting_trial_ends_at set has used the trial.
-- The earliest such project is recorded as the one holding it. (The projects scan in
-- hasUsedHostingTrial keeps covering stamps written by older code after this ran.)
INSERT INTO hosting_trials (user_id, project_id, claimed_at)
SELECT DISTINCT ON (owner) owner, id, least(now(), stamped_at)
FROM (
  SELECT
    regexp_replace(user_id, '^deleted:', '') AS owner,
    id,
    hosting_trial_ends_at - interval '30 days' AS stamped_at,
    hosting_trial_ends_at
  FROM projects
  WHERE hosting_trial_ends_at IS NOT NULL
    AND user_id IS NOT NULL
    AND regexp_replace(user_id, '^deleted:', '') <> ''
) s
ORDER BY owner, hosting_trial_ends_at ASC
ON CONFLICT (user_id) DO NOTHING;
