-- Qads security hardening (security audit 2026-09-23). Idempotent.
-- NOT RUN AGAINST PRODUCTION. Run manually in the Supabase SQL editor, AFTER
-- supabase/migration-credits-v2.sql (the Qads routes now use its RPCs).
--
-- 1. qads_generations had an INSERT policy for end users. Every write goes
--    through the service role (which bypasses RLS), and a client-inserted row
--    could claim any total_credits_reserved / status. The ledger RPCs already
--    cap refunds at what was really debited, but nothing legitimate needs this.
DROP POLICY IF EXISTS qads_generations_insert_own ON public.qads_generations;
REVOKE INSERT, UPDATE, DELETE ON public.qads_generations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.qads_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.qads_ad_copy FROM anon, authenticated;

-- 2. Backstop for "one item per paid slot": the generate route now builds
--    exactly one item per (kind, format, variant), so the DB can enforce it.
--    Skipped (with a notice) if historical duplicates exist — inspect them with
--      SELECT generation_id, kind, format, variant_idx, count(*)
--        FROM qads_items GROUP BY 1,2,3,4 HAVING count(*) > 1;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.qads_items
     GROUP BY generation_id, kind, format, variant_idx
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'qads_items has duplicate slots; unique index uniq_qads_items_slot NOT created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_qads_items_slot
      ON public.qads_items (generation_id, kind, format, variant_idx);
  END IF;
END $$;

-- 3. Speeds up the per-user Qads rate limit (ledger rows by reason + time).
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_reason_created
  ON public.credit_ledger (user_id, reason, created_at DESC);
