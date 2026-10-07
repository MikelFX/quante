-- AssetraDigital website: leads from the homepage contact form („Odeslat poptávku“).
-- Run once in the Supabase SQL editor. Written only by POST /api/leads (service role);
-- RLS is on with no policies and anon/authenticated have no grants, so nothing can read or
-- write this table from the browser.

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  source       text not null default 'web',          -- 'web' (form), later 'qgent' (assistant, with consent)
  name         text not null default '',             -- „Jméno a firma“
  contact      text not null,                        -- „Kontakt“: phone or e-mail
  need         text not null default '',             -- Firemní web | E-shop | Správa | Něco jiného | ''
  message      text not null default '',             -- „Pár slov k zadání“
  status       text not null default 'new',          -- new | contacted | won | lost | spam
  notified_at  timestamptz,                          -- notification e-mail delivered to Resend
  ip_hash      text,                                 -- salted SHA-256 of the IP, only for abuse limits
  user_agent   text,
  constraint leads_contact_len check (char_length(contact) between 3 and 160),
  constraint leads_name_len check (char_length(name) <= 120),
  constraint leads_need_len check (char_length(need) <= 40),
  constraint leads_message_len check (char_length(message) <= 4000),
  constraint leads_status_chk check (status in ('new', 'contacted', 'won', 'lost', 'spam'))
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_ip_hash_created_idx on public.leads (ip_hash, created_at desc);

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
