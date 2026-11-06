// Registry of agent-ready stores (pure, client-safe; tested in __tests__/agent-shops.test.mjs).
// A store is "agent-ready" when it serves /.well-known/agent-shop.json (the open format every
// Quante store carries since scaffold 6, docs/agents/agent-shop.md) — any store on any platform
// can adopt it. The registry only ever trusts what it can read from the store's own origin:
// every URL in the description must be on that origin, every field is capped, nothing in it is
// shown as instructions. Stores are read by lib/agent-shops/registry.ts.

export const WELL_KNOWN_PATH = '/.well-known/agent-shop.json'
/** Products the registry keeps per store (more are ignored, the store is still listed). */
export const MAX_PRODUCTS_PER_SHOP = 2000
/** Consecutive failed daily reads before a store drops out of search (it comes back on the next good read). */
export const UNREACHABLE_AFTER = 3

export interface ShopDoc {
  version: string
  name: string
  description: string
  url: string
  language: string | null
  country: string | null
  currency: string
  productsUrl: string
  ordering: boolean
  mcp: string | null
  shippingMethods: number
  paymentKinds: string[]
}

export interface RegistryProduct {
  productId: string
  name: string
  description: string
  url: string
  image: string | null
  price: number
  compareAt: number | null
  currency: string
  available: boolean
  stock: number | null
  tags: string[]
  searchText: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Lower case, no accents — how search text and queries are compared. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The origin of a store address (https only, except localhost), or null. */
export function shopOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) return null
  try {
    const u = new URL(raw.includes('://') ? raw.trim() : `https://${raw.trim()}`)
    if (u.username || u.password) return null
    if (u.protocol !== 'https:') return null
    return u.origin.toLowerCase()
  } catch {
    return null
  }
}

/** A URL from a store document, accepted only on the store's own origin. */
export function sameOriginUrl(origin: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1000) return null
  try {
    const u = new URL(raw.trim(), `${origin}/`)
    return u.origin.toLowerCase() === origin ? u.href : null
  } catch {
    return null
  }
}

/** An image may live on a CDN: any https URL. */
function imageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

const CURRENCY = /^[A-Z]{3}$/
const COUNTRY = /^[A-Z]{2}$/

/** /.well-known/agent-shop.json → what the registry keeps, or why the store can't be listed. */
export function parseShopDoc(raw: unknown, origin: string): Parsed<ShopDoc> {
  const d = obj(raw)
  const version = str(d.agentShop, 10)
  if (!/^1\.\d+$/.test(version)) return { ok: false, error: 'Not an agent-shop document (agentShop: "1.x" missing).' }
  const shop = obj(d.shop)
  const name = str(shop.name, 120)
  if (!name) return { ok: false, error: 'shop.name is missing.' }
  const currency = str(shop.currency, 10).toUpperCase()
  if (!CURRENCY.test(currency)) return { ok: false, error: 'shop.currency must be a three-letter code.' }
  const catalog = obj(d.catalog)
  const productsUrl = sameOriginUrl(origin, catalog.url)
  if (!productsUrl) return { ok: false, error: 'catalog.url must be on the store\'s own address.' }
  const country = str(shop.country, 10).toUpperCase()
  const language = str(shop.language, 10).toLowerCase()
  const ordering = obj(d.ordering).available === true
  const kinds = Array.isArray(obj(d.payment).methods)
    ? [...new Set((obj(d.payment).methods as unknown[]).map((m) => str(obj(m).kind, 30)).filter((k) => ['online', 'cash_on_delivery', 'bank_transfer'].includes(k)))]
    : []
  return {
    ok: true,
    value: {
      version,
      name,
      description: str(shop.description, 500),
      url: origin,
      language: /^[a-z]{2}(-[a-z]{2})?$/.test(language) ? language : null,
      country: COUNTRY.test(country) ? country : null,
      currency,
      productsUrl,
      ordering,
      mcp: sameOriginUrl(origin, obj(d.interfaces).mcp),
      shippingMethods: Array.isArray(obj(d.shipping).methods) ? Math.min(50, (obj(d.shipping).methods as unknown[]).length) : 0,
      paymentKinds: kinds,
    },
  }
}

function money(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null
}

/** The store's product list (GET catalog.url) → registry rows. Bad rows are skipped, not fatal. */
export function parseProducts(raw: unknown, doc: ShopDoc): RegistryProduct[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(obj(raw).products) ? (obj(raw).products as unknown[]) : []
  const out: RegistryProduct[] = []
  const seen = new Set<string>()
  for (const r of list) {
    if (out.length >= MAX_PRODUCTS_PER_SHOP) break
    const p = obj(r)
    const productId = str(p.id, 200)
    const name = str(p.name, 200)
    const price = money(p.price)
    const url = sameOriginUrl(doc.url, p.url)
    if (!productId || !name || price === null || !url || seen.has(productId)) continue
    seen.add(productId)
    const currency = str(p.currency, 10).toUpperCase()
    const description = str(p.description, 2000)
    const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 20)
    const compare = money(p.compareAtPrice)
    const stock = Number.isInteger(p.stock) && (p.stock as number) >= 0 ? Math.min(999, p.stock as number) : null
    out.push({
      productId,
      name,
      description,
      url,
      image: Array.isArray(p.images) ? imageUrl(p.images[0]) : null,
      price,
      compareAt: compare !== null && compare > price ? compare : null,
      currency: CURRENCY.test(currency) ? currency : doc.currency,
      available: p.available !== false && stock !== 0,
      stock,
      tags,
      searchText: fold([name, name, tags.join(' '), description.slice(0, 600), doc.name].join(' ')).slice(0, 4000),
    })
  }
  return out
}

/** Free text → a safe to_tsquery string (folded words, prefix match, all words required), or null. */
export function tsQuery(q: unknown): string | null {
  const words = fold(str(q, 200)).split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 2).slice(0, 6)
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null
}

export interface SearchFilters { q: string; country: string | null; currency: string | null; maxPrice: number | null; inStock: boolean; limit: number }

/** Query parameters (or MCP arguments) → search filters, or why they are wrong. */
export function parseSearch(input: Record<string, unknown>): Parsed<SearchFilters & { tsquery: string }> {
  const q = str(input.q ?? input.query, 200)
  const tsquery = tsQuery(q)
  if (!tsquery) return { ok: false, error: 'Send q: what to buy (at least one word of 2+ letters).' }
  const country = str(input.country, 10).toUpperCase()
  const currency = str(input.currency, 10).toUpperCase()
  const max = input.maxPrice === undefined || input.maxPrice === null || input.maxPrice === '' ? null : money(input.maxPrice)
  const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit) || 20)))
  const inStock = input.inStock === true || input.inStock === 'true' || input.inStock === '1'
  return {
    ok: true,
    value: { q, tsquery, country: COUNTRY.test(country) ? country : null, currency: CURRENCY.test(currency) ? currency : null, maxPrice: max, inStock, limit },
  }
}

export interface SearchRow {
  shop_id: string; shop_name: string; shop_origin: string; shop_country: string | null; shop_ordering: boolean
  product_id: string; product_name: string; product_description: string | null; product_url: string; product_image: string | null
  price: number | string; compare_at: number | string | null; currency: string; available: boolean; stock: number | null; rank: number
}

/** One search hit as agents see it: the product + where and how to buy it. */
export function searchHit(r: SearchRow) {
  return {
    product: {
      id: r.product_id,
      name: r.product_name,
      description: r.product_description ?? '',
      url: r.product_url,
      image: r.product_image,
      price: Number(r.price),
      compareAtPrice: r.compare_at === null ? null : Number(r.compare_at),
      currency: r.currency,
      available: r.available,
      stock: r.stock,
    },
    shop: {
      name: r.shop_name,
      url: r.shop_origin,
      country: r.shop_country,
      agentShop: r.shop_origin + WELL_KNOWN_PATH,
      ordersFromAgents: r.shop_ordering,
    },
  }
}

export interface ShopRow {
  origin: string; name: string; description: string | null; country: string | null; language: string | null; currency: string | null
  ordering: boolean; products_count: number; in_stock_count: number; listed_at: string; last_ok_at: string | null
}

/** A listed store in the free directory. */
export function shopCard(r: ShopRow) {
  return {
    name: r.name,
    description: r.description ?? '',
    url: r.origin,
    agentShop: r.origin + WELL_KNOWN_PATH,
    country: r.country,
    language: r.language,
    currency: r.currency,
    products: r.products_count,
    inStock: r.in_stock_count,
    ordersFromAgents: r.ordering,
    listedAt: r.listed_at,
    checkedAt: r.last_ok_at,
  }
}

/** After a daily read: the store's next status (a removed store stays removed). */
export function nextStatus(current: string, ok: boolean, failCount: number): 'listed' | 'unreachable' | 'removed' {
  if (current === 'removed') return 'removed'
  if (ok) return 'listed'
  return failCount >= UNREACHABLE_AFTER ? 'unreachable' : current === 'unreachable' ? 'unreachable' : 'listed'
}
