-- Security pass 2 — deploy / domains / misc (audit #38 follow-up).
--
-- projects.custom_domain_set_at: when the project's current custom_domain was set
-- (written by /api/hosting/domain only when the domain CHANGES). A custom domain that
-- is not DNS-verified (custom_domain_verified = false) holds the exact name against
-- other users only for 7 days after this timestamp (UNVERIFIED_CLAIM_TTL_MS in
-- app/api/domains/_lib/release.ts); after that, whoever proves the name can take it.
-- Until this migration runs the column is missing, which the app treats as "age
-- unknown" → the claim keeps holding (fail closed).
--
-- Idempotent; safe to re-run.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_domain_set_at timestamptz;

-- Existing custom domains start their clock now (so a legacy unverified claim ages out
-- 7 days after this migration, never instantly).
UPDATE projects
   SET custom_domain_set_at = now()
 WHERE custom_domain IS NOT NULL
   AND custom_domain_set_at IS NULL;
