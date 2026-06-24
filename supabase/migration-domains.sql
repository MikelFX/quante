create table if not exists user_domains (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references projects(id) on delete set null,
  domain text not null unique,
  status text not null default 'pending',  -- pending | active | failed | expired
  registered_at timestamptz,
  expires_at timestamptz,
  namecheap_order_id text,
  vercel_project_id text,
  stripe_subscription_id text,
  protection_enabled boolean not null default true,
  dns_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_domains enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'user_domains' and policyname = 'owner read') then
    create policy "owner read" on user_domains for select using (user_id = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_domains' and policyname = 'owner insert') then
    create policy "owner insert" on user_domains for insert with check (user_id = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_domains' and policyname = 'owner update') then
    create policy "owner update" on user_domains for update using (user_id = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_domains' and policyname = 'owner delete') then
    create policy "owner delete" on user_domains for delete using (user_id = auth.uid()::text);
  end if;
end $$;
