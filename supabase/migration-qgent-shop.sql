-- Qgent in the Studio (shop mode, 2026-10-08). Idempotent; safe to re-run.
-- Run manually in the Supabase SQL Editor. Until it has run, the Studio's Qgent panel says
-- the feature is not set up and charges nothing.
--
-- qgent_reviews  one store review: what Qgent found, the brief it prepared for Qads, the
--                code version it looked at and what it cost.
-- qgent_actions  every proposed change and what happened to it — the log. A change is
--                applied only after the merchant confirms it (money-related ones need a
--                second, separate confirmation) and becomes a DRAFT code version; undo
--                writes another draft version with the old content of the touched files.
--
-- Service role only (server routes use supabaseAdmin and check project ownership). No
-- policies on purpose: anon/authenticated must not read or write these rows.

CREATE TABLE IF NOT EXISTS qgent_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          text NOT NULL,                                   -- Clerk user id
  created_at       timestamptz NOT NULL DEFAULT now(),
  base_version_id  uuid REFERENCES code_versions(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  summary          text NOT NULL DEFAULT '',
  ads_brief        jsonb,                                           -- { brand, audience, tone, products[] } for Qads
  credits_charged  int NOT NULL DEFAULT 0,
  error            text
);

CREATE INDEX IF NOT EXISTS qgent_reviews_project_idx ON qgent_reviews (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qgent_actions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id              uuid REFERENCES qgent_reviews(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id                text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  title                  text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  why                    text NOT NULL DEFAULT '',
  area                   text NOT NULL DEFAULT '',
  severity               text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high', 'medium', 'low')),
  edits                  jsonb NOT NULL DEFAULT '[]'::jsonb,         -- [{ path, find, replace }]
  sensitive_reasons      text[] NOT NULL DEFAULT '{}',               -- decided by code, not by the model
  status                 text NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed', 'advice', 'applied', 'rejected', 'reverted', 'failed', 'stale')),
  files_before           jsonb,                                      -- touched files before the change (for undo)
  files_after            jsonb,                                      -- touched files after the change
  applied_version_id     uuid REFERENCES code_versions(id) ON DELETE SET NULL,
  reverted_version_id    uuid REFERENCES code_versions(id) ON DELETE SET NULL,
  confirmed_at           timestamptz,
  sensitive_confirmed_at timestamptz,                                -- the second confirmation for money-related changes
  reverted_at            timestamptz,
  credits_charged        int NOT NULL DEFAULT 0,
  error                  text
);

CREATE INDEX IF NOT EXISTS qgent_actions_project_idx ON qgent_actions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qgent_actions_review_idx ON qgent_actions (review_id);

ALTER TABLE qgent_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE qgent_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON qgent_reviews FROM anon, authenticated;
REVOKE ALL ON qgent_actions FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
