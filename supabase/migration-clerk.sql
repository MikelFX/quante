-- Migration: Switch from Supabase Auth to Clerk
-- Run this in Supabase SQL Editor BEFORE deploying the Clerk version.
-- Clerk user IDs are text strings (e.g. user_2abc...) — not UUIDs.

-- Drop foreign key constraints pointing to auth.users
ALTER TABLE projects      DROP CONSTRAINT IF EXISTS projects_user_id_fkey;
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_user_id_fkey;
ALTER TABLE purchases     DROP CONSTRAINT IF EXISTS purchases_user_id_fkey;

-- Change user_id columns from UUID to TEXT
ALTER TABLE projects      ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE credit_ledger ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE purchases     ALTER COLUMN user_id TYPE TEXT;

-- Drop old RLS policies that used auth.uid() (Supabase JWT)
DROP POLICY IF EXISTS "users own projects"           ON projects;
DROP POLICY IF EXISTS "users own manifest_versions"  ON manifest_versions;
DROP POLICY IF EXISTS "users own credit_ledger"      ON credit_ledger;
DROP POLICY IF EXISTS "users own purchases"          ON purchases;
DROP POLICY IF EXISTS "users own exports"            ON exports;
DROP POLICY IF EXISTS "users insert own exports"     ON exports;

-- New RLS policies using Clerk JWT sub claim
-- Note: all server-side code uses the service role client which bypasses RLS.
-- These policies are a defence-in-depth layer for direct Supabase access.
CREATE POLICY "users own projects" ON projects FOR ALL
  USING  ((auth.jwt() ->> 'sub') = user_id)
  WITH CHECK ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "users own manifest_versions" ON manifest_versions FOR ALL
  USING  (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')));

CREATE POLICY "users own credit_ledger" ON credit_ledger FOR SELECT
  USING  ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "users own purchases" ON purchases FOR SELECT
  USING  ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "users own exports" ON exports FOR SELECT
  USING  (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')));

CREATE POLICY "users insert own exports" ON exports FOR INSERT
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = (auth.jwt() ->> 'sub')));
