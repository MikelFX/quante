-- Plnolet: age verification for e-shops (lib/plnolet, owner 2026-11-25).
-- Service role only: RLS on, no policies. Without these tables every Plnolet route fails closed.
-- We never store a shopper's name, birth date or document number — only the result.

create table if not exists plnolet_merchants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,             -- Clerk user id of the merchant's account
  name text not null,
  domains text[] not null default '{}',     -- return_url must be on one of these
  live_enabled boolean not null default false, -- operator switches a merchant to live (after contract)
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists plnolet_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references plnolet_merchants(id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  key_hash text not null unique,            -- sha256 of the key; the key is shown once
  prefix text not null,
  name text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists plnolet_keys_merchant on plnolet_keys (merchant_id);

create table if not exists plnolet_sessions (
  id text primary key,                      -- ses_…, in the shopper's link
  merchant_id uuid not null references plnolet_merchants(id) on delete cascade,
  key_id uuid references plnolet_keys(id) on delete set null,
  mode text not null check (mode in ('test', 'live')),
  threshold int not null check (threshold in (18, 21)),
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  method text check (method in ('test', 'pass', 'mojeid', 'bankid')),
  return_url text not null,
  reference text,
  attempts int not null default 0,
  pass_issued boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz
);
create index if not exists plnolet_sessions_merchant on plnolet_sessions (merchant_id, created_at desc);
create index if not exists plnolet_sessions_key_hour on plnolet_sessions (key_id, created_at desc);

create table if not exists plnolet_passes (
  id uuid primary key default gen_random_uuid(),
  credential_id text not null unique,       -- passkey id (base64url)
  public_key text not null,                 -- SPKI, base64url
  alg int not null check (alg in (-7, -257)),
  sign_count bigint not null default 0,
  mode text not null check (mode in ('test', 'live')),
  over18 boolean not null,
  over21 boolean not null,
  method text not null,                     -- what proved the age when the pass was issued
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table plnolet_merchants enable row level security;
alter table plnolet_keys enable row level security;
alter table plnolet_sessions enable row level security;
alter table plnolet_passes enable row level security;
