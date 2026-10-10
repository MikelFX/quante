-- Qads community library (2026-10-10). Run once in the Supabase SQL editor. Idempotent.
--
-- Every Generate on /qads asks whether the finished photos and videos may appear on the public
-- community wall (app/qads/QadsCommunityWall.tsx). The answer is stored per generation; the owner
-- can change it later in the history. Only finished outputs are ever shown — never the uploaded
-- product photos. qads_items.community_hidden lets the operator take a single piece down:
--   UPDATE qads_items SET community_hidden = true WHERE id = '<item id>';
-- Until this runs, Generate still works (nothing is shared) and the wall shows the seed media.

ALTER TABLE public.qads_generations ADD COLUMN IF NOT EXISTS share_community boolean NOT NULL DEFAULT false;
ALTER TABLE public.qads_items ADD COLUMN IF NOT EXISTS community_hidden boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS qads_generations_shared_idx
  ON public.qads_generations (id) WHERE share_community;
CREATE INDEX IF NOT EXISTS qads_items_community_idx
  ON public.qads_items (completed_at DESC) WHERE status = 'completed' AND community_hidden = false;

-- Check:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND column_name IN ('share_community', 'community_hidden');
