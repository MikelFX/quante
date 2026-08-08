-- Changelog v3 — auto-logged entries from production deploys (V3 feature).
-- Safe to run on top of migration-changelog.sql + migration-changelog-v2.sql.
-- Run in the Supabase SQL editor.
--
-- ⚠️ ORDERING: run this BEFORE deploying app/api/webhooks/vercel-deploy and
-- BEFORE the app/(marketing)/changelog/page.tsx build that filters on
-- `published`. If that code ships before this migration runs, every request
-- to /changelog will error on the unknown "published" column and fall back
-- to the static content/changelog.json (fails safe, not silently broken —
-- see the data-changelog-source='fallback-error' marker added in V2 to check
-- this without DB or Vercel log access).

alter table changelog_entries
  add column if not exists deployment_id text,
  add column if not exists published boolean not null default true;

-- One changelog row per Vercel deployment — this is what makes the webhook
-- handler idempotent against redelivery (insert-first-then-act; see
-- app/api/webhooks/vercel-deploy/route.ts and lib/vercel-webhook.ts). Postgres
-- unique indexes treat NULL as distinct from every other NULL, so manually
-- created entries (deployment_id IS NULL, the default for anything typed into
-- /admin) never collide with each other or with webhook-created rows.
create unique index if not exists changelog_entries_deployment_id_idx
  on changelog_entries (deployment_id);

-- Drafts (published = false) must never appear on the public page — only
-- /admin lists and publishes them. Index supports that filter + the "which
-- drafts are pending" admin view.
create index if not exists changelog_entries_published_idx
  on changelog_entries (published);
