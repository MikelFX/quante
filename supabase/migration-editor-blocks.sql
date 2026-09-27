-- Visual editor v3 — "My elements" (2026-09-27). Idempotent; safe to re-run.
-- Run manually in the Supabase SQL Editor.
--
-- A merchant saves a selected element (a button, a card, a whole section — made by hand,
-- from the palette or with AI) and inserts it again anywhere, in any of their stores.
-- `snippet` is static JSX that passed lib/editor/snippet.ts validateSnippet() when it was
-- saved; it is validated AGAIN on every insert (the insert goes through the same editor
-- 'edit' path as palette blocks), so a row is never trusted as-is.
-- Used by app/api/editor-blocks/route.ts and the 'save_block' action of
-- app/api/projects/[id]/editor/route.ts. Until this table exists the editor hides the
-- "My elements" list and saving answers 503.
CREATE TABLE IF NOT EXISTS editor_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,                                        -- Clerk user id
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  snippet     text NOT NULL CHECK (char_length(snippet) BETWEEN 1 AND 6000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_blocks_user_idx
  ON editor_blocks (user_id, created_at DESC);

-- Service role only (server routes use supabaseAdmin, which bypasses RLS). No policies
-- on purpose: anon/authenticated must not read or write other users' blocks.
ALTER TABLE editor_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON editor_blocks FROM anon, authenticated;
