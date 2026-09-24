-- migration-security-foundation.sql — audit 2026-09, finding #0 / #38
--
-- Splits the public store subdomain from the (user/AI-controlled, non-unique) store
-- name. projects.store_slug is claimed once per project by getOrClaimStoreSlug()
-- (lib/hosting/vercel.ts) and never re-derived, so two tenants can never share a
-- <slug>.stores.quantecode.com host and renaming a project can't move/collide it.
-- The UNIQUE index is what makes the claim race-safe (the app retries on 23505).
--
-- Idempotent: safe to run more than once.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS store_slug text;

-- NULLs are distinct in a unique index, so unclaimed projects don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS projects_store_slug_idx ON projects (store_slug);


-- ─── One-off backfill (best effort) ───────────────────────────────────────────
-- Existing live stores should keep their current subdomain. This derives
-- store_slug from each project's most recent READY deployment whose domain is
-- '<slug>.stores.quantecode.com'.
--   * If your HOSTING_ROOT_DOMAIN env var is not 'stores.quantecode.com', change
--     the domain literal / regex below before running.
--   * A slug that is the latest live host of MORE THAN ONE project is ambiguous
--     (the cross-tenant takeover bug this migration fixes) and is deliberately NOT
--     backfilled — review those with the query further down and assign by hand.
--   * Guarded by store_slug IS NULL and NOT EXISTS, so re-running is a no-op.

WITH latest AS (
  SELECT DISTINCT ON (d.project_id)
         d.project_id,
         split_part(d.domain, '.', 1) AS slug
  FROM deployments d
  WHERE d.status = 'ready'
    AND d.domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.stores\.quantecode\.com$'
  ORDER BY d.project_id, d.created_at DESC
),
unambiguous AS (
  SELECT slug, min(project_id::text) AS project_id
  FROM latest
  GROUP BY slug
  HAVING count(*) = 1
)
UPDATE projects p
SET store_slug = u.slug
FROM unambiguous u
WHERE p.id::text = u.project_id
  AND p.store_slug IS NULL
  AND NOT EXISTS (SELECT 1 FROM projects o WHERE o.store_slug = u.slug);


-- ─── Manual review queries (read-only; run and act on the results) ───────────
--
-- 1) Ambiguous subdomains — several projects' latest live deploy used the same host:
--
-- SELECT split_part(d.domain, '.', 1) AS slug, array_agg(DISTINCT d.project_id) AS projects
-- FROM deployments d
-- WHERE d.status = 'ready' AND d.domain LIKE '%.stores.quantecode.com'
-- GROUP BY 1 HAVING count(DISTINCT d.project_id) > 1;
--
-- 2) Vercel projects shared by several Quante projects (created by the old
--    name-based ensureVercelProject). Each tenant must be moved to its own
--    UUID-named Vercel project: set the non-owner rows' vercel_project_id to NULL
--    (ensureProjectVercel() then creates 'q-<uuid>' on the next deploy), and re-set
--    QUANTE_PROJECT_ID / QUANTE_API_KEY on the shared Vercel project for the
--    rightful owner from project_secrets.
--
-- SELECT vercel_project_id, array_agg(id ORDER BY created_at) AS projects
-- FROM projects
-- WHERE vercel_project_id IS NOT NULL
-- GROUP BY vercel_project_id HAVING count(*) > 1;
