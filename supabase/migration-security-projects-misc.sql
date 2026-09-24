-- migration-security-projects-misc.sql
-- Security hardening for the "projects-misc" audit group (findings #63, #83).
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) #83 — wipe merchants' legacy PLAINTEXT Stripe keys.
--
-- migration-admin-panel.sql created project_secrets.stripe_secret_key /
-- stripe_publishable_key and the old admin panel stored merchants' own live Stripe
-- secret keys there unencrypted. Nothing in the app reads them any more
-- (app/api/projects/[id]/orders now serves store_orders instead).
--
-- BEFORE running this, export the list of affected merchants so they can be told
-- to ROLL their Stripe secret keys (the keys sat in plaintext, and database
-- backups / PITR snapshots still contain them):
--
--   select project_id, user_id
--   from project_secrets
--   where stripe_secret_key is not null
--     and stripe_secret_key not like 'sk_%_replace%';
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_secrets' and column_name = 'stripe_secret_key'
  ) then
    execute 'update public.project_secrets set stripe_secret_key = null where stripe_secret_key is not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_secrets' and column_name = 'stripe_publishable_key'
  ) then
    execute 'update public.project_secrets set stripe_publishable_key = null where stripe_publishable_key is not null';
  end if;
end $$;

-- Once the null-out has been verified, drop the columns entirely (uncomment):
-- alter table public.project_secrets drop column if exists stripe_secret_key;
-- alter table public.project_secrets drop column if exists stripe_publishable_key;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) #63 — make the public store-assets bucket enforce the same limits as
--    app/api/upload/route.ts, so a bypass of the route can't upload HTML/SVG or
--    huge files. Raster images only (NO image/svg+xml), max 8 MB.
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
    file_size_limit = 8388608
where id = 'store-assets';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) #65 — zasilkovna_api_password was stored in PLAINTEXT by /api/project/secrets.
--    The route now encrypts it. Existing plaintext rows can't be encrypted in SQL
--    (the AES key lives in the app env, SECRETS_ENCRYPTION_KEY). Find them with:
--
--   select project_id from project_secrets
--   where zasilkovna_api_password is not null
--     and zasilkovna_api_password not like 'enc:v1:%';
--
--    and either have the merchant re-save the password in Admin → Settings, or run a
--    one-off Node script that rewrites each value with lib/crypto.ts encryptSecret().
-- ─────────────────────────────────────────────────────────────────────────────
