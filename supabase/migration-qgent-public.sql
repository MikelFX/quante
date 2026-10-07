-- Qgent on the AssetraDigital website (public assistant). Run once in the Supabase SQL editor.
-- Written only by POST /api/qgent/public and the cleanup cron (service role). RLS is on with no
-- policies and anon/authenticated have no grants, so nothing is readable from the browser.
--
-- Until this has run, the assistant answers "temporarily unavailable" (it fails closed, because
-- without these tables there are no message limits and no monthly cost cap).

-- One row per anonymous chat (the id is a random UUID generated in the visitor's browser).
-- Transcripts are stored with e-mails and phone numbers removed and deleted after 30 days.
create table if not exists public.qgent_public_sessions (
  id             uuid primary key,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '30 days',
  ip_hash        text not null,                      -- salted SHA-256 of the IP, only for abuse limits
  page           text not null default '/',
  message_count  int not null default 0,
  transcript     jsonb not null default '[]'::jsonb, -- [{ role, text }] with contacts redacted
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  cost_usd       numeric(12, 6) not null default 0
);

create index if not exists qgent_public_sessions_ip_idx on public.qgent_public_sessions (ip_hash, updated_at desc);
create index if not exists qgent_public_sessions_expires_idx on public.qgent_public_sessions (expires_at);

-- Spend per calendar month (UTC), for the hard monthly cap and the 80 % alert.
create table if not exists public.qgent_public_usage (
  month       text primary key,                      -- 'YYYY-MM'
  cost_usd    numeric(12, 6) not null default 0,
  requests    int not null default 0,
  alerted_at  timestamptz
);

alter table public.qgent_public_sessions enable row level security;
alter table public.qgent_public_usage enable row level security;
revoke all on public.qgent_public_sessions from anon, authenticated;
revoke all on public.qgent_public_usage from anon, authenticated;

-- Admits one visitor message, atomically: monthly cap, per-session and per-IP limits, then
-- counts the message. Returns 'ok' | 'cap' | 'session' | 'ip'.
create or replace function public.qgent_public_admit(
  p_session uuid, p_ip_hash text, p_page text,
  p_max_session int, p_max_ip_day int, p_cap_usd numeric
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_spent numeric;
  v_count int;
  v_ip int;
begin
  select cost_usd into v_spent from qgent_public_usage where month = v_month;
  if coalesce(v_spent, 0) >= p_cap_usd then return 'cap'; end if;

  select message_count into v_count from qgent_public_sessions where id = p_session for update;
  if coalesce(v_count, 0) >= p_max_session then return 'session'; end if;

  select coalesce(sum(message_count), 0) into v_ip
    from qgent_public_sessions
   where ip_hash = p_ip_hash and updated_at > now() - interval '1 day';
  if v_ip >= p_max_ip_day then return 'ip'; end if;

  insert into qgent_public_sessions (id, ip_hash, page, message_count)
  values (p_session, p_ip_hash, left(p_page, 200), 1)
  on conflict (id) do update
     set message_count = qgent_public_sessions.message_count + 1,
         updated_at = now(),
         expires_at = now() + interval '30 days',
         ip_hash = excluded.ip_hash,
         page = excluded.page;
  return 'ok';
end;
$$;

-- Records one answer: the redacted transcript, tokens and cost on the session and the month.
-- Returns true exactly once per month, when spend first crosses p_alert_usd (send the alert).
create or replace function public.qgent_public_record(
  p_session uuid, p_transcript jsonb, p_input_tokens bigint, p_output_tokens bigint,
  p_cost numeric, p_alert_usd numeric
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_total numeric;
  v_alerted timestamptz;
begin
  update qgent_public_sessions
     set transcript = p_transcript,
         input_tokens = input_tokens + p_input_tokens,
         output_tokens = output_tokens + p_output_tokens,
         cost_usd = cost_usd + p_cost,
         updated_at = now()
   where id = p_session;

  insert into qgent_public_usage (month, cost_usd, requests)
  values (v_month, p_cost, 1)
  on conflict (month) do update
     set cost_usd = qgent_public_usage.cost_usd + excluded.cost_usd,
         requests = qgent_public_usage.requests + 1
  returning cost_usd, alerted_at into v_total, v_alerted;

  if v_alerted is null and v_total >= p_alert_usd then
    update qgent_public_usage set alerted_at = now() where month = v_month and alerted_at is null;
    return found;
  end if;
  return false;
end;
$$;

revoke all on function public.qgent_public_admit(uuid, text, text, int, int, numeric) from public, anon, authenticated;
revoke all on function public.qgent_public_record(uuid, jsonb, bigint, bigint, numeric, numeric) from public, anon, authenticated;
grant execute on function public.qgent_public_admit(uuid, text, text, int, int, numeric) to service_role;
grant execute on function public.qgent_public_record(uuid, jsonb, bigint, bigint, numeric, numeric) to service_role;
