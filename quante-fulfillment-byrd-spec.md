# Quante Fulfillment — byrd integrace (implementační zadání)

> Zadání pro Claude Code. Pracuj po fázích, každou fázi commitni zvlášť.
> Neimplementuj všechno najednou — po každé fázi se zastav a nech si to zkontrolovat.

---

## 0. NEŽ NAPÍŠEŠ PRVNÍ ŘÁDEK KÓDU

**Nehádej endpointy ani tvar request bodies.** Stáhni si reálnou dokumentaci:

```
https://developers.getbyrd.com/llms.txt
```

Tam je index všech stránek v Markdownu a OpenAPI spec. Přečti si minimálně:

- `docs/authentication.md` — jak získat a refreshovat token
- `docs/how-to-call-bryd-apis.md`
- `docs/frequency-of-calls-to-the-api.md` — rate limity
- `docs/integration-overview.md`
- `docs/creating-a-shipment.md` + `reference/shipmentlistapiv3_post.md`
- `docs/listing-shipments.md`
- `docs/listing-products.md` + `reference/productsapi_post.md`
- `docs/announcing-returns.md`

Base URL je `https://api.getbyrd.com`. Shipmenty jsou `/v3`, produkty/deliveries `/v2`.

Pokud něco v dokumentaci nenajdeš, **napiš to do TODO a zeptej se** — nevymýšlej si pole.

---

## 1. Abstrakce, ne jednorázová integrace

První commit je interface, ne byrd kód. byrd je jen první implementace — Skladon a Shipmonk přijdou později.

```ts
// lib/fulfillment/types.ts
export interface FulfillmentProvider {
  readonly slug: string;

  testConnection(): Promise<{ ok: boolean; accountName?: string; error?: string }>;

  syncProduct(product: QuanteProduct): Promise<{ externalId: string }>;
  getStock(skus?: string[]): Promise<StockLevel[]>;

  createShipment(order: QuanteOrder, idempotencyKey: string): Promise<{ externalId: string }>;
  getShipment(externalId: string): Promise<ShipmentStatus>;

  announceReturn(orderId: string, items: ReturnItem[]): Promise<{ externalId: string }>;
}
```

Struktura:

```
lib/fulfillment/
  types.ts          # interface + doménové typy (nezávislé na byrd)
  registry.ts       # slug -> provider factory
  providers/
    byrd/
      client.ts     # HTTP + auth
      mapper.ts     # Quante <-> byrd mapování
      index.ts      # implementace FulfillmentProvider
```

**Doménové typy nesmí obsahovat byrd-specifická pole.** Všechno mapování žije v `mapper.ts`.

---

## 2. byrd client (auth vrstva)

- Přihlášení přes API key + secret → JWT access token + refresh token.
- **Token cachuj.** Nelogovat se při každém requestu — mají rate limity.
  Cache v Supabase (`fulfillment_tokens`) nebo Vercel KV, s TTL o něco kratším než expirace tokenu.
- Při 401 → jeden refresh a retry. Při druhém 401 → označ integraci jako `auth_failed` a zastav se.
- Retry s exponenciálním backoffem jen na 429 a 5xx. **Nikdy neretryuj POST shipmentu naslepo** (viz fáze 6).
- Všechny requesty logovat do `fulfillment_api_log` (endpoint, status, latence, ne credentials).

---

## 3. Databáze (Supabase migrace)

```sql
create table store_fulfillment_integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  provider text not null,                    -- 'byrd'
  credentials_encrypted text not null,       -- NIKDY plaintext
  status text not null default 'pending',    -- pending|active|auth_failed|disabled
  external_account_name text,
  last_stock_sync_at timestamptz,
  created_at timestamptz default now(),
  unique (store_id, provider)
);

create table fulfillment_product_links (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references store_fulfillment_integrations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  external_product_id text not null,
  sku text not null,
  synced_at timestamptz,
  unique (integration_id, product_id)
);

create table fulfillment_shipments (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references store_fulfillment_integrations(id),
  order_id uuid not null references orders(id),
  external_shipment_id text,
  status text not null default 'creating',   -- creating|created|failed|sent|delivered|returned
  tracking_number text,
  tracking_url text,
  carrier text,
  customer_notified_at timestamptz,
  error text,
  attempts int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (order_id)                          -- <<< KRITICKÉ, viz fáze 6
);
```

Credentials šifruj symetricky klíčem z env (`FULFILLMENT_ENCRYPTION_KEY`), ne plaintextem, ne base64.
RLS: merchant vidí jen řádky svého storu.

---

## 4. Sync produktů (Quante → byrd)

- Manuální akce z adminu, ne automat při každém uložení produktu.
- Match primárně podle SKU. Produkt bez SKU sync neprojde — vrať srozumitelnou chybu.
- Uloz `external_product_id` do `fulfillment_product_links`.
- Idempotentní: opakovaný sync existující produkt aktualizuje, nevytváří duplicitu.

---

## 5. Sync skladu (byrd → Quante)

- Vercel cron, každých 15 min: `/api/cron/fulfillment-stock`
- Pro každou `active` integraci: stáhni stavy, updatni `stock_available` u napojených produktů.
- Zapiš `last_stock_sync_at`.
- **Storefront musí respektovat `stock_available`** — vyprodané produkty nejde přidat do košíku a checkout je odmítne.
- Cron endpoint chraň `CRON_SECRET` headerem.

---

## 6. Objednávka → zásilka (NEJDŮLEŽITĚJŠÍ ČÁST)

Trigger: Stripe webhook `checkout.session.completed`.

**Stripe webhooky se opakují. Dvakrát vytvořená zásilka = fyzicky odeslané zboží navíc = reálná finanční ztráta.**

Povinný postup:

1. Ověř Stripe podpis.
2. `INSERT INTO fulfillment_shipments (order_id, status) VALUES (..., 'creating')`
   → díky `unique (order_id)` druhý paralelní webhook selže na constraintu.
3. Pokud insert selhal na unique violation → **vrať 200 a skonči**. Není to chyba.
4. Teprve po úspěšném insertu volej `createShipment()`.
5. Podle výsledku nastav `status = 'created'` + `external_shipment_id`, nebo `'failed'` + `error`.

Pravidla:

- Vytvoření shipmentu **nikdy neretryuj automaticky** při timeoutu nebo nejasné odpovědi. Nech `status = 'creating'`, zaloguj, a vyřeš to reconciliací (níže).
- Reconciliace: samostatný cron projde záznamy ve stavu `creating` starší než 10 minut, dohledá v byrd podle reference (order number), a buď doplní `external_shipment_id`, nebo uvolní k novému pokusu.
- Webhook handler vždy vrátí 200 rychle. Těžkou práci dělej v background funkci, ne inline — jinak Stripe timeoutne a pošle retry.

---

## 7. Tracking (byrd → zákazník)

byrd **nemá webhooky na tracking** — musí se pollovat.

- Vercel cron každou hodinu: `/api/cron/fulfillment-tracking`
- Vezmi shipmenty ve stavu `created`/`sent` mladší než 30 dní, stáhni jejich stav.
- Při přechodu na `sent`: ulož tracking number, carrier, URL, updatni order status.
- Pošli zákazníkovi email přes Resend. **Až po úspěšném odeslání nastav `customer_notified_at`** — jinak při chybě posíláš email opakovaně.
- Šablona emailu v češtině i angličtině podle jazyka storu.

---

## 8. Admin UI

V adminu storu sekce **Fulfillment**:

- Připojení: pole na API key/secret, tlačítko "Otestovat spojení" (volá `testConnection()`).
- Tabulka produktů: napojeno / nenapojeno, tlačítko sync.
- Přehled zásilek: order number, stav, tracking, případná chyba.
- Manuální "zkusit znovu" u zásilek ve stavu `failed`.
- Viditelný stav integrace včetně `auth_failed` s výzvou k obnově credentials.

---

## Pravidla

- TypeScript strict. Žádné `any` na hranici s API — napiš typy podle OpenAPI.
- Žádné credentials do logů, do klienta, do error messages.
- Každá fáze = samostatný commit s funkčním buildem.
- U fází 6 a 7 napiš testy: duplicitní webhook, selhání API, částečná odpověď.
- Neměň existující generation/deployment flow. Tohle je nový modul.

## Hotovo, když

1. Merchant připojí byrd účet z adminu a vidí "Připojeno".
2. Nasynchronizuje produkty podle SKU.
3. Stav skladu se sám aktualizuje a storefront ho respektuje.
4. Objednávka vytvoří v byrd právě jednu zásilku — i když Stripe webhook přijde třikrát.
5. Zákazník dostane email s trackingem, právě jednou.
6. Přidání druhého providera nevyžaduje sáhnout do checkout flow.
