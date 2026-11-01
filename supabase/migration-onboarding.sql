-- Onboarding answers (2026-11-01). Idempotent; safe to re-run. Run manually in the Supabase SQL Editor.
-- The wizard at /start works without it: answers are always saved on the Clerk profile
-- (publicMetadata.onboarding). This table only makes them queryable next to the rest of the data.
--
-- One row per account (Clerk user id), overwritten each time the wizard is finished or skipped.
-- Service role only (POST /api/onboarding); no RLS policy = no access with the anon key.

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id      text PRIMARY KEY,
  persona      text CHECK (persona IN ('business', 'creator', 'agency')),
  goal         text CHECK (goal IN ('ads', 'scan', 'new', 'edit', 'review')),
  ad_kind      text CHECK (ad_kind IN ('ad', 'character', 'plan')),
  skipped      boolean NOT NULL DEFAULT false,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- What new accounts want:
--   SELECT persona, goal, ad_kind, count(*) FROM user_onboarding WHERE NOT skipped GROUP BY 1, 2, 3 ORDER BY 4 DESC;
