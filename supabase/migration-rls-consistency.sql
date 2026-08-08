-- RLS consistency fix (2026-08-07) — NOT RUN AGAINST PRODUCTION. Prepared as a file only.
--
-- Problem: auth moved from Supabase Auth to Clerk a while back (see migration-clerk.sql),
-- and every RLS policy written since then correctly uses (auth.jwt() ->> 'sub') to read the
-- Clerk user id out of the JWT. A handful of older policies — written before that pattern
-- was settled, or copy-pasted from an even older policy — still use auth.uid()::text
-- instead. Today this happens to still work, because Supabase's Clerk JWT integration maps
-- the JWT's `sub` claim into auth.uid() as well, so auth.uid()::text and
-- (auth.jwt() ->> 'sub') currently resolve to the same value. But that's an incidental
-- mapping detail of the current Supabase<->Clerk wiring, not a documented guarantee — if it
-- ever changes, every policy still using auth.uid()::text silently starts denying (or, worse,
-- silently misscoping) access with no application-level error, since all server code reads
-- through the service-role client (which bypasses RLS entirely) and would never notice.
--
-- This migration does not change access behavior today (auth.uid()::text and
-- (auth.jwt() ->> 'sub') currently agree) — it only removes the inconsistency so every
-- policy in the schema uses the same, currently-canonical pattern. All server-side code paths
-- use supabaseAdmin (service role, bypasses RLS) regardless — RLS here is defence-in-depth,
-- not the primary access control — so this is a low-risk, purely preventive cleanup.
--
-- Affected: custom_components, user_domains (4 policies), store_earnings,
-- store_payout_accounts, payout_requests (2 policies), store_orders. 10 policies total.
--
-- Run in the Supabase SQL editor once approved. Safe to re-run (DROP POLICY IF EXISTS).

-- ── custom_components (migration-custom-components.sql) ────────────────────────
DROP POLICY IF EXISTS "Users can view own custom components" ON custom_components;
CREATE POLICY "Users can view own custom components" ON custom_components
  FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub'))
  );

-- ── user_domains (migration-domains.sql) ────────────────────────────────────────
DROP POLICY IF EXISTS "owner read" ON user_domains;
CREATE POLICY "owner read" ON user_domains
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "owner insert" ON user_domains;
CREATE POLICY "owner insert" ON user_domains
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "owner update" ON user_domains;
CREATE POLICY "owner update" ON user_domains
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "owner delete" ON user_domains;
CREATE POLICY "owner delete" ON user_domains
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- ── store_earnings (migration-managed-payments.sql) ─────────────────────────────
DROP POLICY IF EXISTS "Users can view own store earnings" ON store_earnings;
CREATE POLICY "Users can view own store earnings" ON store_earnings
  FOR SELECT USING (
    project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub'))
  );

-- ── store_payout_accounts (migration-managed-payments.sql) ──────────────────────
DROP POLICY IF EXISTS "Users can manage own payout accounts" ON store_payout_accounts;
CREATE POLICY "Users can manage own payout accounts" ON store_payout_accounts
  FOR ALL USING (user_id = (auth.jwt() ->> 'sub'));

-- ── payout_requests (migration-managed-payments.sql) ─────────────────────────────
DROP POLICY IF EXISTS "Users can view own payout requests" ON payout_requests;
CREATE POLICY "Users can view own payout requests" ON payout_requests
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "Users can insert own payout requests" ON payout_requests;
CREATE POLICY "Users can insert own payout requests" ON payout_requests
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- ── store_orders (migration-orders.sql) ──────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own store orders" ON store_orders;
CREATE POLICY "Users can view own store orders" ON store_orders
  FOR SELECT USING (
    project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub'))
  );

-- Verification query — run after applying, should return zero rows:
-- SELECT tablename, policyname, qual FROM pg_policies
--   WHERE qual::text LIKE '%auth.uid()%' AND schemaname = 'public';
