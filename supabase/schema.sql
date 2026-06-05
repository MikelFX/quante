-- Quante database schema
-- Run this in Supabase SQL Editor after creating your project

-- Projects
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'draft', -- draft | generating | ready
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Manifest versions (append-only for free undo/history)
create table if not exists manifest_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version_no integer not null,
  manifest jsonb not null,
  prompt text,
  created_at timestamptz not null default now(),
  unique(project_id, version_no)
);

-- Credit ledger (immutable audit trail)
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null, -- positive = credit, negative = debit
  reason text not null,   -- 'signup_grant' | 'generate' | 'iterate' | 'export' | 'purchase' | 'refund'
  ref_id uuid,            -- optional: project_id, purchase_id, etc.
  balance_after integer not null,
  created_at timestamptz not null default now()
);

-- Purchases (Stripe)
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text not null unique,
  credits integer not null,
  amount_cents integer not null,
  created_at timestamptz not null default now()
);

-- Exports
create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version_id uuid references manifest_versions(id),
  size_bytes integer,
  created_at timestamptz not null default now()
);

-- updated_at trigger for projects
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- Row Level Security
alter table projects enable row level security;
alter table manifest_versions enable row level security;
alter table credit_ledger enable row level security;
alter table purchases enable row level security;
alter table exports enable row level security;

-- RLS Policies: users can only access their own data
create policy "users own projects"
  on projects for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users own manifest_versions"
  on manifest_versions for all
  using (
    project_id in (select id from projects where user_id = auth.uid())
  )
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users own credit_ledger"
  on credit_ledger for select
  using (user_id = auth.uid());

create policy "users own purchases"
  on purchases for select
  using (user_id = auth.uid());

create policy "users own exports"
  on exports for select
  using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users insert own exports"
  on exports for insert
  with check (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- Service role can write to credit_ledger and purchases (webhooks, server actions)
create policy "service writes credit_ledger"
  on credit_ledger for insert
  with check (true); -- restricted by service_role key at app level

create policy "service writes purchases"
  on purchases for insert
  with check (true);
