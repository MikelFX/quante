-- Agency tier: users table + subscription support
-- Run in Supabase SQL Editor after the base schema.

-- Account-level user record (tier, subscription state, project limit)
create table if not exists users (
  id                    text primary key,        -- Clerk user_id
  tier                  text not null default 'free'
                          check (tier in ('free', 'credit', 'agency')),
  stripe_subscription_id text,
  stripe_customer_id    text,
  subscription_status   text,                    -- active | past_due | canceled | etc.
  current_period_end    timestamptz,
  project_limit         int not null default 3,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();

alter table users enable row level security;

-- Users can read their own row; service role (supabaseAdmin) bypasses RLS automatically
create policy "users read own row"
  on users for select
  using ((auth.jwt() ->> 'sub') = id);

-- Index for webhook lookups by Stripe subscription/customer
create index if not exists users_stripe_subscription_id_idx
  on users (stripe_subscription_id) where stripe_subscription_id is not null;

create index if not exists users_stripe_customer_id_idx
  on users (stripe_customer_id) where stripe_customer_id is not null;
