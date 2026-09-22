-- Qads generator (v2) — standalone /qads page that produces ad videos + photos from
-- a product photo via Higgsfield. Replaces the old in-Studio Qads campaign builder
-- (see supabase/migration-qads.sql for that schema — those tables stay in place per
-- the "don't delete data" instruction, they just stop being written to). This
-- migration adds three fresh tables owned exclusively by the new /qads flow.
--
-- Table split:
--   qads_generations — one row per generation job (a batch of items from one form
--     submit). Holds the input snapshot (photos + product + settings) and the
--     reserved credit total.
--   qads_items — one row per generated asset (per format × variant × kind). Tracks
--     its Higgsfield request_id, per-item status, storage path, and per-item
--     credit charge (needed so a single failed item can refund its own cost
--     without touching successful sibling items).
--   qads_ad_copy — the ad-copy strings Claude produces alongside the visual
--     generation (hook, primary text, headline, CTA, optional video script /
--     subtitles). One row per (generation, format, variant, language) — kept in
--     its own table so text regeneration doesn't have to rewrite qads_items.
--
-- All three carry `user_id text` (Clerk sub, same shape as every other user_id
-- column in this schema). RLS: users can select their own rows; only the
-- service_role writes status updates from the Higgsfield webhook.
--
-- Not-mazané tabulky (staré Studio Qads, přestávají být zapisovány):
--   qads_ad_accounts, qads_campaigns, qads_campaign_channel_links, qads_angles,
--   qads_ad_sets, qads_ads, qads_metrics, qads_experiments, qads_audit_log,
--   qads_assets, qads_creatives. qads_assets + qads_creatives ale zůstávají čtené
--   pro historii (union se qads_items níže) — user rozhodne později co s prázdnými.

-- ─── qads_generations ─────────────────────────────────────────────────
create table if not exists public.qads_generations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  -- Optional link to a Quante project (populated when the user picked a product
  -- from their Quante store in the "product picker" — see the /qads form). null
  -- when the user filled the form from scratch without linking to a project.
  project_id uuid references public.projects(id) on delete set null,

  -- Input snapshot — what the user typed/uploaded at submit time.
  product_name text not null,
  product_description text not null default '',
  -- Public Supabase Storage URLs (privátní bucket qads-inputs, signed at upload
  -- time by /api/qads/upload) for the 1-4 product photos the user provided.
  input_photo_urls text[] not null,

  -- Form settings snapshot. Kept as concrete columns rather than a single jsonb
  -- so a future admin dashboard can filter on them cheaply.
  output_types text[] not null check (output_types <@ array['image','video'] and array_length(output_types, 1) between 1 and 2),
  formats text[] not null check (formats <@ array['9:16','4:5','1:1','16:9'] and array_length(formats, 1) between 1 and 4),
  style text not null,
  variants_per_format smallint not null check (variants_per_format between 1 and 4),
  -- Only meaningful when 'video' is in output_types; kept nullable rather than
  -- 0-defaulting so a photos-only generation reads honest.
  video_duration_s smallint check (video_duration_s is null or video_duration_s between 4 and 30),
  language text not null default 'cs' check (language in ('cs','en','sk','de')),

  -- Credits reserved atomically at submit time. Per-item cost lives on qads_items
  -- so refunds are per-item, not blanket.
  total_credits_reserved integer not null check (total_credits_reserved >= 0),

  -- Aggregate status derived from qads_items on the way in/out:
  --   queued      — nothing has started yet (webhook hasn't fired)
  --   generating  — at least one item is in-flight
  --   completed   — every item is completed
  --   partial     — everything reached a terminal state, some succeeded, some didn't
  --   failed      — every item failed / nsfw / canceled
  status text not null default 'queued' check (status in ('queued','generating','completed','partial','failed')),

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_qads_generations_user_id on public.qads_generations (user_id, created_at desc);
create index if not exists idx_qads_generations_project_id on public.qads_generations (project_id) where project_id is not null;

alter table public.qads_generations enable row level security;

drop policy if exists qads_generations_select_own on public.qads_generations;
create policy qads_generations_select_own on public.qads_generations
  for select using (user_id = (auth.jwt() ->> 'sub'));

drop policy if exists qads_generations_insert_own on public.qads_generations;
create policy qads_generations_insert_own on public.qads_generations
  for insert with check (user_id = (auth.jwt() ->> 'sub'));

-- ─── qads_items ────────────────────────────────────────────────────────
create table if not exists public.qads_items (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.qads_generations(id) on delete cascade,
  -- Denormalised user_id so RLS can gate this table without a join. Same trick
  -- credit_ledger uses.
  user_id text not null,

  kind text not null check (kind in ('image','video')),
  format text not null check (format in ('9:16','4:5','1:1','16:9')),
  variant_idx smallint not null check (variant_idx between 0 and 3),

  -- Higgsfield submit inputs — kept so a regenerate-this-item action can rebuild
  -- the exact same request without re-running Claude.
  prompt_used text not null,
  higgsfield_model text not null,
  higgsfield_request_id text unique,      -- populated only after successful submit
  higgsfield_status_url text,             -- from submit response, used by the sweep cron
  higgsfield_cancel_url text,

  -- Output — filled in by the Higgsfield webhook once the asset lands. Storage
  -- path is inside the qads-outputs privátní bucket.
  storage_bucket text,
  storage_path text,
  mime_type text,

  status text not null default 'queued' check (status in ('queued','generating','completed','failed','nsfw','canceled')),
  error_message text,

  credits_charged integer not null check (credits_charged >= 0),

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_qads_items_generation_id on public.qads_items (generation_id);
create index if not exists idx_qads_items_user_id on public.qads_items (user_id, created_at desc);
-- Needed by the sweep-stuck cron: "give me every item that's been queued or
-- generating for more than 10 minutes and has a status_url I can poll."
create index if not exists idx_qads_items_stuck_lookup on public.qads_items (status, created_at)
  where status in ('queued','generating') and higgsfield_status_url is not null;

alter table public.qads_items enable row level security;

drop policy if exists qads_items_select_own on public.qads_items;
create policy qads_items_select_own on public.qads_items
  for select using (user_id = (auth.jwt() ->> 'sub'));

-- ─── qads_ad_copy ──────────────────────────────────────────────────────
create table if not exists public.qads_ad_copy (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.qads_generations(id) on delete cascade,
  user_id text not null,

  format text not null check (format in ('9:16','4:5','1:1','16:9')),
  variant_idx smallint not null check (variant_idx between 0 and 3),
  language text not null check (language in ('cs','en','sk','de')),

  -- Meta / TikTok-style ad copy fields — text-only, media lives on qads_items.
  hook text not null,
  primary_text text not null,
  headline text not null,
  cta text not null,

  -- Video-only extras. video_script is the shot-by-shot brief Claude wrote for
  -- the video model prompt; subtitles is a nullable jsonb array of
  -- {start_ms, end_ms, text} entries a caller can burn in themselves. Neither
  -- is required for image-only variants.
  video_script text,
  subtitles jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_qads_ad_copy_generation_id on public.qads_ad_copy (generation_id);

-- Unique per (generation, format, variant, language) so a regenerate-copy call
-- can UPSERT cleanly.
create unique index if not exists uniq_qads_ad_copy_slot
  on public.qads_ad_copy (generation_id, format, variant_idx, language);

alter table public.qads_ad_copy enable row level security;

drop policy if exists qads_ad_copy_select_own on public.qads_ad_copy;
create policy qads_ad_copy_select_own on public.qads_ad_copy
  for select using (user_id = (auth.jwt() ->> 'sub'));

-- ─── Storage buckets ──────────────────────────────────────────────────
-- Two privátní buckets — inputs (user-uploaded product photos, ~small) and
-- outputs (Higgsfield-generated assets after we copy them off Higgsfield URLs
-- because their URLs expire in ~7 days). Both signed-URL-only; nothing here is
-- publicly readable. Create idempotently so re-running the migration is safe.
insert into storage.buckets (id, name, public)
values ('qads-inputs',  'qads-inputs',  false),
       ('qads-outputs', 'qads-outputs', false)
on conflict (id) do nothing;

-- No storage.objects RLS policies added here — access is exclusively via signed
-- URLs generated server-side by the service role (same posture the storefront
-- generator's admin bucket uses). Add read policies later if we ever want the
-- authed user's client to fetch these directly.
