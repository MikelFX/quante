-- Qads Plan (2026-10-29). Idempotent; safe to re-run. Run manually in the Supabase SQL Editor.
-- Until it has run, /qads → Plan says it is not set up (before charging anything) and the rest
-- of Qads works as before.
--
-- qads_plans  one growth plan for one store: the owner's inputs, the competitor ads read from the
--             Meta Ad Library (text only, no snapshots) and the plan (personas, insights, ad
--             concepts, posting calendar). Ad concepts are drafts for the normal Qads composers;
--             nothing here renders or spends by itself.
--
-- Service role only (server routes use supabaseAdmin and check project ownership). No policies
-- on purpose: anon/authenticated must not read or write these rows.

CREATE TABLE IF NOT EXISTS qads_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,                                   -- Clerk user id
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  input            jsonb NOT NULL DEFAULT '{}'::jsonb,
  research         jsonb NOT NULL DEFAULT '{}'::jsonb,              -- { status, ads: [...] }
  plan             jsonb,
  error            text,
  credits_charged  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qads_plans_user_idx ON qads_plans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qads_plans_project_idx ON qads_plans (project_id, created_at DESC);

ALTER TABLE qads_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qads_plans FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- Check:
--   SELECT status, count(*) FROM qads_plans GROUP BY status;
