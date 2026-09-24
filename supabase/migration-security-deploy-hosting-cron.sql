-- Security pass (audit 2026-09, group deploy-hosting-cron) — idempotent, safe to re-run.
-- Run AFTER supabase/migration-security-foundation.sql (projects.store_slug).
--
-- #38: one custom domain = one project. /api/hosting/domain already checks this in
-- code; this index closes the race between the check and the write. The index is only
-- created when no duplicates exist yet. If it is skipped (NOTICE below), resolve
-- duplicates first with:
--   SELECT lower(custom_domain), array_agg(id) FROM projects
--   WHERE custom_domain IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'projects_custom_domain_unique_idx') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM projects
    WHERE custom_domain IS NOT NULL
    GROUP BY lower(custom_domain)
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'projects_custom_domain_unique_idx NOT created: duplicate custom_domain values exist';
    RETURN;
  END IF;
  CREATE UNIQUE INDEX projects_custom_domain_unique_idx
    ON projects (lower(custom_domain))
    WHERE custom_domain IS NOT NULL;
END $$;

-- #37: deleted projects that have financial history, or that ever had a public
-- store subdomain, are soft-deleted (projects.status = 'deleted',
-- user_id = 'deleted:<owner>') so store_orders, store_earnings, payout_requests and
-- hosting_subscriptions survive for audit — their FKs are ON DELETE CASCADE — and the
-- tombstone keeps store_slug reserved so another tenant can't take over the old
-- <slug>.stores host. No schema change needed; this index just keeps the hosting
-- cron's `status <> 'deleted'` filter cheap.
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);

-- #40: /api/cron/hosting persists its keyset-pagination cursor here so a run that
-- hits its time budget resumes where it stopped instead of restarting at the first
-- project id (which would starve projects late in id order). Server-only: RLS on and
-- no policies, so only the service-role client can read or write it. The cron works
-- without this table (it just restarts from the beginning each run).
CREATE TABLE IF NOT EXISTS cron_state (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cron_state ENABLE ROW LEVEL SECURITY;
