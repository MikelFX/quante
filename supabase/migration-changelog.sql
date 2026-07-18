-- Changelog entries — public product changelog, managed from /admin.
-- Run in Supabase SQL Editor.

create table if not exists changelog_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists changelog_entries_date_idx on changelog_entries (date desc);

-- Service-role access only (no policies) — reads happen server-side.
alter table changelog_entries enable row level security;

-- Seed from the former content/changelog.json (only if the table is empty).
insert into changelog_entries (date, title, description, tags)
select * from (values
  ('2026-07-05'::date, 'Hero iframe showcase + build error recovery',
   'Homepage hero now embeds a live generated store (Maison Sève) instead of the static AURA mockup. Fixed a race condition in SSE log streaming where a failed first-generation build could leave the Studio stuck on loading forever.',
   array['platform','bugfix']),
  ('2026-07-04'::date, 'Custom domain purchasing via Namecheap',
   'You can now search, buy, and connect a custom domain directly inside the Studio. Quante handles DNS configuration and SSL provisioning automatically. Domains are billed via your existing Stripe payment method.',
   array['feature','domains']),
  ('2026-06-28'::date, 'Mobile responsiveness across all platform pages',
   'Complete mobile pass across the dashboard, Studio, billing, and settings pages. All layouts now adapt gracefully down to 320px viewport width.',
   array['platform','design']),
  ('2026-06-22'::date, 'Project deletion + bulk export gating',
   'Projects can now be deleted from the dashboard (with a confirmation prompt). Bulk export is now gated to Agency plan users. Fixed a bug where the project limit was not enforced correctly on the first generation attempt.',
   array['platform','bugfix']),
  ('2026-06-15'::date, 'Generation reliability — 40k token model, soft abort',
   'Switched the generation model to Claude Sonnet with a 40k token budget. Added a soft-abort mechanism so incomplete responses are recovered client-side rather than timing out. Eliminates the rare ''generation stuck'' state.',
   array['ai','reliability']),
  ('2026-06-08'::date, 'Studio redesign with ambient motion',
   'Builder and admin UIs rebuilt with a wider layout, layered surface system, and purposeful ambient motion. Split view now uses the full screen width. Version timeline is more accessible on smaller displays.',
   array['design','platform'])
) as seed(date, title, description, tags)
where not exists (select 1 from changelog_entries);
