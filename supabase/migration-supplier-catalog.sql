-- Supplier catalog (CLAUDE.md §13r, owner 2026-11-25: "uživatel najde produkty, připíše si je do
-- svého eshopu a objednávka přijde skladu, kde produkt je").
--
-- suppliers              dropship partners the operator added in Admin (feed + order e-mail)
-- supplier_products      the catalog: one row per product in a supplier's feed (daily import)
-- store_supplier_links   which product of a store is which catalog product
-- supplier_orders        what was sent to which supplier for which store order (one row per
--                        order × supplier: UNIQUE = never two shipments for one order)
--
-- Every table is SERVICE ROLE ONLY (RLS on, no policies): the app reads and writes through
-- server routes that check the signed-in owner. Without this migration the catalog says
-- "not set up" and orders are never sent anywhere (fails closed).
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS suppliers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL UNIQUE,
  name                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  feed_url               text NOT NULL,
  feed_format            text NOT NULL DEFAULT 'auto' CHECK (feed_format IN ('auto', 'heureka', 'google', 'csv')),
  wholesale_field        text,
  wholesale_discount_pct numeric CHECK (wholesale_discount_pct IS NULL OR (wholesale_discount_pct > 0 AND wholesale_discount_pct < 90)),
  currency               text NOT NULL DEFAULT 'CZK',
  order_email            text NOT NULL,
  dispatch_days          integer NOT NULL DEFAULT 2,
  ships_to               text[] NOT NULL DEFAULT ARRAY['CZ'],
  note                   text,
  product_count          integer NOT NULL DEFAULT 0,
  last_import_at         timestamptz,
  last_import_error      text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS supplier_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  external_id     text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  brand           text NOT NULL DEFAULT '',
  category        text NOT NULL DEFAULT '',
  images          text[] NOT NULL DEFAULT '{}',   -- the SUPPLIER's URLs: shown in the Studio only, copied on "Add to store"
  wholesale_cents integer NOT NULL CHECK (wholesale_cents > 0),
  retail_cents    integer,
  currency        text NOT NULL,
  ean             text NOT NULL DEFAULT '',
  sku             text NOT NULL DEFAULT '',
  stock           integer,
  available       boolean NOT NULL DEFAULT true,
  dispatch_days   integer,
  search_text     text NOT NULL DEFAULT '',       -- folded (lib/suppliers/model.ts foldText)
  seen_at         timestamptz NOT NULL DEFAULT now(), -- last import that still listed it
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, external_id)
);
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS supplier_products_search_idx ON supplier_products USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS supplier_products_brand_idx ON supplier_products (brand);
CREATE INDEX IF NOT EXISTS supplier_products_supplier_idx ON supplier_products (supplier_id, seen_at);

CREATE TABLE IF NOT EXISTS store_supplier_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id             text NOT NULL,
  product_id          text NOT NULL,              -- the store product's id in data/products.ts
  supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_product_id uuid NOT NULL REFERENCES supplier_products(id) ON DELETE RESTRICT,
  wholesale_cents     integer NOT NULL,           -- the price when the merchant last saw it (price alert)
  price_alert         boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, product_id)
);
ALTER TABLE store_supplier_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS store_supplier_links_product_idx ON store_supplier_links (supplier_product_id);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  supplier_id   uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'sent', 'failed', 'shipped', 'cannot')),
  items         jsonb NOT NULL DEFAULT '[]',
  token_hash    text NOT NULL,                    -- sha256 of the link the supplier confirms with
  attempts      integer NOT NULL DEFAULT 0,
  tracking_code text,
  tracking_url  text,
  carrier       text,
  error         text,
  sent_at       timestamptz,
  shipped_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, supplier_id)
);
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS supplier_orders_project_idx ON supplier_orders (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_orders_status_idx ON supplier_orders (status, updated_at);
