-- Brand kit (Dashboard phase 2, 2026-10-28). Idempotent; safe to re-run. Run manually in the
-- Supabase SQL Editor. Until it has run, the Dashboard shows the brand kit as "not set up" and
-- Qads, Qgent, Qscan and the editor simply work without it.
--
-- brand_kits  one row per brand (= project / store): logo, photos and texts the owner keeps once
--             and every module reuses. Colours are not here — they stay in the store's
--             config.design (Studio → Theme). URLs point only at the owner's own files in the
--             public store-assets bucket (checked in code, lib/brand-kit/model.ts).
--
-- Service role only (server routes use supabaseAdmin and check project ownership). No policies
-- on purpose: anon/authenticated must not read or write these rows.

CREATE TABLE IF NOT EXISTS brand_kits (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id     text NOT NULL,                                        -- Clerk user id
  logo_url    text,
  photos      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 24),
  texts       jsonb NOT NULL DEFAULT '{}'::jsonb,                   -- { tagline, description, audience, tone }
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brand_kits_user_idx ON brand_kits (user_id);

ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Check:
--   SELECT count(*) AS kits, count(*) FILTER (WHERE cardinality(photos) > 0) AS with_photos FROM brand_kits;
