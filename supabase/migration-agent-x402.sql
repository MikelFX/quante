-- Pay-per-call agent tools (lib/agents/pay-per-call.ts, 2026-11-05): one row per x402 payment that
-- settled for a call made with no account (product lookup, store scan). Best-effort bookkeeping:
-- the chain is the source of truth, a missing table never fails a call. Service role only.
create table if not exists agent_x402_calls (
  id          bigserial primary key,
  tool        text not null,
  usd_micros  bigint not null check (usd_micros > 0),
  network     text not null,
  tx          text not null,
  payer       text,
  resource    text,
  created_at  timestamptz not null default now(),
  unique (network, tx)
);
create index if not exists agent_x402_calls_created on agent_x402_calls (created_at desc);
create index if not exists agent_x402_calls_tool on agent_x402_calls (tool, created_at desc);

alter table agent_x402_calls enable row level security;
-- no policies: only the service role (server) reads and writes
