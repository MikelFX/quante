-- Agent-ready store registry (lib/agent-shops/*, 2026-11-06): stores that describe themselves for
-- AI agents with /.well-known/agent-shop.json, and their products, so an agent can ask "where can
-- I buy X" across all of them. A Quante store is listed by its owner (Dashboard → Agents, a
-- one-time fee in credits); the registry re-reads every listed store daily (/api/cron/agent-shops).
-- Service role only. Safe to run more than once.

create table if not exists agent_shops (
  id              uuid primary key default gen_random_uuid(),
  origin          text not null unique,
  project_id      uuid unique references projects(id) on delete cascade,
  user_id         text not null,
  name            text not null,
  description     text,
  country         text,
  language        text,
  currency        text,
  status          text not null default 'listed' check (status in ('listed', 'unreachable', 'removed')),
  ordering        boolean not null default false,
  products_count  integer not null default 0,
  in_stock_count  integer not null default 0,
  doc             jsonb,
  listed_at       timestamptz not null default now(),
  checked_at      timestamptz,
  last_ok_at      timestamptz,
  fail_count      integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now()
);
create index if not exists agent_shops_status on agent_shops (status, country);
create index if not exists agent_shops_user on agent_shops (user_id);

create table if not exists agent_shop_products (
  shop_id      uuid not null references agent_shops(id) on delete cascade,
  product_id   text not null,
  name         text not null,
  description  text,
  url          text not null,
  image        text,
  price        numeric(14, 2) not null,
  compare_at   numeric(14, 2),
  currency     text not null,
  available    boolean not null default true,
  stock        integer,
  tags         text[] not null default '{}',
  search_text  text not null,
  search       tsvector generated always as (to_tsvector('simple', search_text)) stored,
  primary key (shop_id, product_id)
);
create index if not exists agent_shop_products_search on agent_shop_products using gin (search);
create index if not exists agent_shop_products_price on agent_shop_products (price);

alter table agent_shops enable row level security;
alter table agent_shop_products enable row level security;
-- no policies: only the service role (server) reads and writes

-- Product search across listed stores. p_query is a to_tsquery string built by the server from
-- folded (lower-case, no accents) words only: lib/agent-shops/model.ts tsQuery().
create or replace function agent_shop_search(
  p_query      text,
  p_country    text default null,
  p_currency   text default null,
  p_max_price  numeric default null,
  p_in_stock   boolean default false,
  p_limit      integer default 20
)
returns table (
  shop_id uuid, shop_name text, shop_origin text, shop_country text, shop_ordering boolean,
  product_id text, product_name text, product_description text, product_url text, product_image text,
  price numeric, compare_at numeric, currency text, available boolean, stock integer, rank real
)
language sql stable
as $$
  select s.id, s.name, s.origin, s.country, s.ordering,
         p.product_id, p.name, left(p.description, 500), p.url, p.image,
         p.price, p.compare_at, p.currency, p.available, p.stock,
         ts_rank(p.search, to_tsquery('simple', p_query))
  from agent_shop_products p
  join agent_shops s on s.id = p.shop_id
  where s.status = 'listed'
    and p.search @@ to_tsquery('simple', p_query)
    and (p_country is null or s.country = p_country)
    and (p_currency is null or p.currency = p_currency)
    and (p_max_price is null or p.price <= p_max_price)
    and (not coalesce(p_in_stock, false) or p.available)
  order by p.available desc, 16 desc, p.price asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke execute on function agent_shop_search(text, text, text, numeric, boolean, integer) from public, anon, authenticated;
