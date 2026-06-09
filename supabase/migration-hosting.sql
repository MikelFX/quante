-- Migration: Quante managed hosting (Deploy to Vercel)
-- Run in Supabase SQL Editor AFTER the Clerk migration.

-- Add Vercel project pointer to projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS vercel_project_id TEXT;

-- Hosting subscriptions (one per project, one active subscription max)
CREATE TABLE IF NOT EXISTS hosting_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  status text NOT NULL,           -- active | trialing | past_due | canceled | incomplete | unpaid
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hosting_subscriptions_project_idx
  ON hosting_subscriptions(project_id);
CREATE INDEX IF NOT EXISTS hosting_subscriptions_user_idx
  ON hosting_subscriptions(user_id);

CREATE TRIGGER hosting_subscriptions_updated_at
  BEFORE UPDATE ON hosting_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Deployments — one per deploy attempt, latest row per project tracks current state
CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  vercel_project_id text NOT NULL,
  vercel_deployment_id text,
  status text NOT NULL DEFAULT 'queued',  -- queued | building | ready | error | canceled
  url text,                                -- raw Vercel deployment url
  domain text,                             -- assigned subdomain or custom domain
  custom_domain text,                      -- user-supplied custom domain (nullable)
  custom_domain_verified boolean DEFAULT false,
  version integer,                         -- manifest_versions.version_no that was deployed
  version_id uuid REFERENCES manifest_versions(id),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deployments_project_idx
  ON deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deployments_user_idx
  ON deployments(user_id);

CREATE TRIGGER deployments_updated_at
  BEFORE UPDATE ON deployments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE hosting_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own hosting_subscriptions" ON hosting_subscriptions FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id);

CREATE POLICY "users own deployments" ON deployments FOR SELECT
  USING ((auth.jwt() ->> 'sub') = user_id);

-- Service role bypasses RLS; server-side code uses supabaseAdmin and writes freely.
