-- Public agent numbers (lib/agents/visits.ts + lib/agents/stats.ts, owner 2026-11-06: "čísla na webu,
-- kolik agentů jsme přivítali, kolik nakoupilo"). One row per agent per day, with NO address and no
-- raw User-Agent: agent_hash = sha256(ip | user-agent | salt) cut to 32 hex chars, agent = the first
-- product token of the User-Agent (e.g. "GPTBot/1.1", "python-requests/2.32"). Best-effort: a missing
-- table never fails a request, the counters just stay empty. Service role only.
create table if not exists agent_visits (
  day         date not null default current_date,
  agent_hash  text not null check (char_length(agent_hash) = 32),
  kind        text not null check (kind in ('markdown', 'api', 'mcp', 'paid', 'llms', 'discovery')),
  agent       text check (char_length(agent) <= 80),
  first_seen  timestamptz not null default now(),
  primary key (day, agent_hash)
);
create index if not exists agent_visits_hash on agent_visits (agent_hash);

alter table agent_visits enable row level security;
-- no policies: only the service role (server) reads and writes

-- The public counters in one round trip (GET /api/agent/v1/stats). Only the service role may call it.
create or replace function agent_public_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'agentsWelcomed', (select count(distinct agent_hash) from agent_visits),
    'agentsToday', (select count(distinct agent_hash) from agent_visits where day = current_date),
    'agentsLast30Days', (select count(distinct agent_hash) from agent_visits where day >= current_date - 30),
    'visitDays', (select count(*) from agent_visits),
    'byKind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(distinct agent_hash) as n from agent_visits group by kind) k),
    'topAgents', (select coalesce(jsonb_agg(jsonb_build_object('agent', agent, 'agents', n) order by n desc), '[]'::jsonb)
                  from (select agent, count(distinct agent_hash) as n from agent_visits where agent is not null group by agent order by n desc limit 8) t),
    'since', (select min(first_seen) from agent_visits)
  );
$$;
revoke all on function agent_public_stats() from public;
grant execute on function agent_public_stats() to service_role;
