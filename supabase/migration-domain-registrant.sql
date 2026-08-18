-- Domain purchase: real registrant data + refund tracking.
--
-- Context: registerDomain() used to send fixed, fake company WHOIS data for
-- every customer (read from empty/placeholder env vars in practice, which
-- meant real registrations would likely fail Namecheap's WHOIS validation).
-- Now the customer's own registrant data is collected in a form BEFORE the
-- Stripe charge, validated server-side, and stored here so the webhook can
-- read it back after payment succeeds (Stripe Checkout Session metadata is
-- not a great place for structured PII — small size limits, no validation,
-- lingers in the Stripe dashboard indefinitely).
--
-- Do NOT run this automatically — apply it manually against the project's
-- Supabase instance, same as the other migration-*.sql files in this repo.

create table if not exists pending_domain_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references projects(id) on delete set null,
  domain text not null,
  price numeric not null,
  currency text not null default 'usd',
  include_protection boolean not null default false,

  registrant_first_name text not null,
  registrant_last_name text not null,
  registrant_address1 text not null,
  registrant_city text not null,
  registrant_state_province text,
  registrant_postal_code text not null,
  registrant_country text not null,
  registrant_phone text not null,
  registrant_email text not null,

  -- pending: created at checkout time, not yet consumed
  -- consumed: webhook read it and (attempted to) register the domain
  -- expired:  never completed checkout; safe to purge after ~24h (no cron yet — manual/future cleanup)
  status text not null default 'pending',
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists pending_domain_purchases_user_id_idx on pending_domain_purchases (user_id);
create index if not exists pending_domain_purchases_stripe_session_id_idx on pending_domain_purchases (stripe_session_id);

-- Service-role only table (written by /api/domains/purchase and read by the
-- Stripe webhook, both using the Supabase admin client). No end-user client
-- ever queries this directly, so RLS stays enabled with no permissive
-- policies — the default-deny behavior is exactly what we want here since
-- this table holds registrant PII (name/address/phone).
alter table pending_domain_purchases enable row level security;

-- user_domains: track the Stripe payment_intent so a failed registration can
-- trigger an automatic refund, and add a distinct status for "we charged the
-- customer, registration failed, we refunded them" so it's visible in the DB
-- (as opposed to silently landing in status = 'failed' with no money moved).
alter table user_domains add column if not exists stripe_payment_intent_id text;
alter table user_domains add column if not exists refund_reason text;
-- status values now: pending | active | failed | failed_refunded | expired
