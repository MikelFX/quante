-- Changelog v2 — adds updated_at (for edit tracking) and slug (for deep-linking).
-- Safe to run on top of migration-changelog.sql. Run in Supabase SQL editor.

alter table changelog_entries
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists slug text;

-- Backfill slug from title where missing (simple ASCII fallback; unique via -id suffix if collision).
update changelog_entries
set slug = regexp_replace(
  regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'),
  '(^-+|-+$)', '', 'g'
)
where slug is null or slug = '';

-- Ensure slug uniqueness — append short id suffix to duplicates.
with dups as (
  select id, slug,
         row_number() over (partition by slug order by created_at) as rn
  from changelog_entries
)
update changelog_entries e
set slug = e.slug || '-' || substr(e.id::text, 1, 6)
from dups
where dups.id = e.id and dups.rn > 1;

create unique index if not exists changelog_entries_slug_idx on changelog_entries (slug);

-- Auto-touch updated_at on any UPDATE.
create or replace function set_changelog_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists changelog_entries_updated_at on changelog_entries;
create trigger changelog_entries_updated_at
  before update on changelog_entries
  for each row execute function set_changelog_updated_at();
