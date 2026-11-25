// Supplier catalog (CLAUDE.md §13r) — the pure rules: how a feed item becomes a catalog row, how
// the catalog is searched, how a catalog product becomes a store product, and which orders go to
// which supplier. No I/O and no `@/` imports, so __tests__/supplier-catalog.test.mjs loads it
// straight from the .ts file.

import type { FeedItem } from './feed.ts'

export type SupplierStatus = 'active' | 'paused'

/** A row of `suppliers` as the importer and the dispatcher need it. */
export interface Supplier {
  id: string
  slug: string
  name: string
  status: SupplierStatus
  feed_url: string
  feed_format: 'auto' | 'heureka' | 'google' | 'csv'
  wholesale_field: string | null
  /** Discount off the feed's retail price when the feed carries no wholesale price (agreed with the supplier). */
  wholesale_discount_pct: number | null
  currency: string
  order_email: string
  dispatch_days: number
  ships_to: string[]
  note: string | null
}

/** What the importer writes into `supplier_products` (minus supplier_id / timestamps). */
export interface CatalogRow {
  external_id: string
  name: string
  description: string
  brand: string
  category: string
  images: string[]
  wholesale_cents: number
  retail_cents: number | null
  currency: string
  ean: string
  sku: string
  stock: number | null
  available: boolean
  dispatch_days: number | null
  search_text: string
}

export const CATALOG_LIMITS = {
  pageSize: 24,
  maxPage: 200,
  queryWords: 6,
  /** A merchant may not sell below wholesale, nor more than this many times above it. */
  maxMarkup: 10,
  /** A change of the wholesale price above this share is shown to the merchant. */
  priceAlertShare: 0.05,
  /** Products a merchant adds in one go. */
  addBatch: 20,
} as const

/** Lower-case, no diacritics, only a–z 0–9 and single spaces: the form search runs on. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The words of a search query (folded, ≥ 2 characters, at most CATALOG_LIMITS.queryWords). */
export function searchWords(q: unknown): string[] {
  if (typeof q !== 'string') return []
  const words = foldText(q.slice(0, 200)).split(' ').filter((w) => w.length >= 2)
  return [...new Set(words)].slice(0, CATALOG_LIMITS.queryWords)
}

const CURRENCY = /^[A-Z]{3}$/

function cents(major: number | null): number | null {
  if (major === null || !Number.isFinite(major) || major <= 0) return null
  return Math.round(major * 100)
}

/**
 * A feed item → a catalog row, or null when it cannot be sold through the catalog (no id, no
 * name, or no price the merchant would pay). Without a wholesale price in the feed the agreed
 * discount off the supplier's retail price is used; without either the item is skipped.
 */
export function normalizeItem(item: FeedItem, supplier: Pick<Supplier, 'currency' | 'wholesale_discount_pct' | 'dispatch_days'>): CatalogRow | null {
  const externalId = (item.externalId || item.sku || item.ean).trim().slice(0, 120)
  const name = item.name.trim()
  if (!externalId || !name) return null
  const retail = cents(item.retailPrice)
  let wholesale = cents(item.wholesalePrice)
  const discount = supplier.wholesale_discount_pct
  if (wholesale === null && retail !== null && typeof discount === 'number' && discount > 0 && discount < 90) {
    wholesale = Math.round(retail * (1 - discount / 100))
  }
  if (wholesale === null || wholesale <= 0) return null
  const currency = (item.currency && CURRENCY.test(item.currency) ? item.currency : supplier.currency).toUpperCase()
  return {
    external_id: externalId,
    name,
    description: item.description,
    brand: item.brand,
    category: item.category,
    images: item.images,
    wholesale_cents: wholesale,
    // A "retail" price under the wholesale one is a feed error — never suggest selling at a loss.
    retail_cents: retail !== null && retail > wholesale ? retail : null,
    currency,
    ean: item.ean,
    sku: item.sku,
    stock: item.stock,
    available: item.available && item.stock !== 0,
    dispatch_days: item.deliveryDays ?? supplier.dispatch_days ?? null,
    search_text: foldText([name, item.brand, item.category, item.ean, item.sku, externalId].join(' ')).slice(0, 600),
  }
}

/** Round a price up to a shop-like ending: CZK … 9, other currencies … .99. Major units. */
export function nicePrice(major: number, currency: string): number {
  if (!Number.isFinite(major) || major <= 0) return 0
  if (currency.toUpperCase() === 'CZK') return Math.max(9, Math.ceil((major + 1) / 10) * 10 - 1)
  return Math.max(0.99, Math.ceil(major) - 0.01)
}

/** The price we pre-fill: the supplier's recommended retail price, else wholesale × 1.6, rounded nicely. */
export function suggestedPrice(row: Pick<CatalogRow, 'wholesale_cents' | 'retail_cents' | 'currency'>): number {
  if (row.retail_cents !== null && row.retail_cents > row.wholesale_cents) return row.retail_cents / 100
  return nicePrice((row.wholesale_cents * 1.6) / 100, row.currency)
}

export function margin(priceMajor: number, wholesaleCents: number): { amount: number; share: number } {
  const p = Math.round(priceMajor * 100)
  const amount = (p - wholesaleCents) / 100
  return { amount, share: p > 0 ? (p - wholesaleCents) / p : 0 }
}

export type PriceCheck = { ok: true; price: number } | { ok: false; error: string }

/** The merchant's selling price for a catalog product (major units). */
export function checkRetailPrice(input: unknown, wholesaleCents: number): PriceCheck {
  const n = typeof input === 'string' ? Number(input.replace(',', '.')) : Number(input)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter a selling price.' }
  const price = Math.round(n * 100) / 100
  if (Math.round(price * 100) < wholesaleCents) return { ok: false, error: 'The price is below what you pay the supplier.' }
  if (price * 100 > wholesaleCents * CATALOG_LIMITS.maxMarkup) return { ok: false, error: `The price is more than ${CATALOG_LIMITS.maxMarkup}× the wholesale price.` }
  return { ok: true, price }
}

/** A catalog product can only be sold in a store with the same currency (no conversion in phase 1). */
export function sameCurrency(storeCurrency: string | null | undefined, itemCurrency: string): boolean {
  return !!storeCurrency && storeCurrency.toUpperCase() === itemCurrency.toUpperCase()
}

function slugify(s: string): string {
  return foldText(s).replace(/ /g, '-').slice(0, 80) || 'product'
}

export interface StoreProductLike {
  id: string
  name: string
  description: string
  price: number
  images: string[]
  slug: string
  available: boolean
  sku?: string
  tags?: string[]
}

/** Store product id for a catalog product: stable, so adding it twice is detectable. */
export function catalogProductId(supplierProductId: string): string {
  return `sup-${supplierProductId.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}`
}

/**
 * A catalog row → the product written into the store's data/products.ts. `images` are OUR copies
 * (store-assets) — never the supplier's URLs, so the store never hotlinks the supplier.
 */
export function toStoreProduct(
  row: Pick<CatalogRow, 'name' | 'description' | 'brand' | 'category' | 'ean' | 'sku' | 'available'> & { id: string },
  price: number,
  images: string[],
  existing: Array<Pick<StoreProductLike, 'id' | 'slug'>>,
): StoreProductLike {
  const id = catalogProductId(row.id)
  const slugs = new Set(existing.map((p) => p.slug))
  const base = slugify(row.name)
  let slug = base
  for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`
  const tags = [row.brand, row.category.split(/[|>]/).map((s) => s.trim()).filter(Boolean).pop() ?? '']
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
  const product: StoreProductLike = {
    id,
    name: row.name.slice(0, 200),
    description: row.description.slice(0, 5000),
    price,
    images: images.slice(0, 8),
    slug,
    available: row.available,
  }
  const sku = (row.sku || row.ean).slice(0, 64)
  if (sku) product.sku = sku
  if (tags.length) product.tags = [...new Set(tags)]
  return product
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface OrderForDispatch {
  status: string | null
  payment_status: string | null
  payment_method?: string | null
}

/**
 * An order goes to its suppliers once the money is in and nobody has shipped or cancelled it:
 * paid online, or a bank transfer the merchant marked paid. Cash on delivery is never sent
 * automatically — the supplier's carrier would collect the customer's money (the merchant
 * forwards those by hand, said in the Studio).
 */
export function shouldDispatch(order: OrderForDispatch): boolean {
  if (order.payment_method === 'dobirka') return false
  return order.payment_status === 'paid' && order.status === 'paid'
}

export interface LinkForOrder {
  product_id: string
  supplier_id: string
  supplier_product_id: string
  external_id: string
  name: string
  ean: string
  sku: string
  wholesale_cents: number
}

export interface SupplierLine {
  productId: string
  variantId: string | null
  externalId: string
  name: string
  ean: string
  sku: string
  quantity: number
  wholesaleCents: number
}

/** The order's lines grouped by supplier; lines with no supplier (the merchant's own goods) are left out. */
export function splitBySupplier(items: unknown, links: LinkForOrder[]): Map<string, SupplierLine[]> {
  const byProduct = new Map(links.map((l) => [l.product_id, l]))
  const out = new Map<string, SupplierLine[]>()
  if (!Array.isArray(items)) return out
  for (const raw of items as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id : ''
    const link = byProduct.get(id)
    const quantity = Number(raw.quantity)
    if (!link || !Number.isInteger(quantity) || quantity <= 0 || quantity > 999) continue
    const variantId = typeof raw.variantId === 'string' && raw.variantId ? raw.variantId : null
    const lines = out.get(link.supplier_id) ?? []
    const same = lines.find((l) => l.productId === id && l.variantId === variantId)
    if (same) same.quantity += quantity
    else lines.push({
      productId: id, variantId, externalId: link.external_id, name: link.name, ean: link.ean, sku: link.sku,
      quantity, wholesaleCents: link.wholesale_cents,
    })
    out.set(link.supplier_id, lines)
  }
  return out
}

/** True when every line of the order is a supplier line (then the supplier's shipment ships the whole order). */
export function coversWholeOrder(items: unknown, links: LinkForOrder[]): boolean {
  if (!Array.isArray(items) || items.length === 0) return false
  const ids = new Set(links.map((l) => l.product_id))
  return (items as Array<Record<string, unknown>>).every((i) => i && typeof i.id === 'string' && ids.has(i.id))
}

/** Should the merchant hear that the supplier's price moved? */
export function priceMoved(oldCents: number | null, newCents: number | null): boolean {
  if (!oldCents || !newCents) return false
  return Math.abs(newCents - oldCents) / oldCents > CATALOG_LIMITS.priceAlertShare
}

// ── The supplier's confirmation (tracking) ───────────────────────────────────

export type TrackingInput =
  | { ok: true; action: 'shipped'; trackingCode: string; trackingUrl: string | null; carrier: string | null }
  | { ok: true; action: 'cannot'; reason: string }
  | { ok: false; error: string }

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function parseTrackingInput(body: unknown): TrackingInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (b.action === 'cannot') {
    const reason = clean(b.reason, 500)
    if (reason.length < 3) return { ok: false, error: 'Napište prosím důvod.' }
    return { ok: true, action: 'cannot', reason }
  }
  const trackingCode = clean(b.trackingCode, 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{3,79}$/.test(trackingCode)) return { ok: false, error: 'Zadejte číslo zásilky.' }
  let trackingUrl: string | null = null
  const rawUrl = clean(b.trackingUrl, 500)
  if (rawUrl) {
    try {
      const u = new URL(rawUrl)
      if (u.protocol !== 'https:' || u.username || u.password) return { ok: false, error: 'Odkaz na sledování musí začínat https://' }
      trackingUrl = u.toString()
    } catch {
      return { ok: false, error: 'Odkaz na sledování není platná adresa.' }
    }
  }
  return { ok: true, action: 'shipped', trackingCode, trackingUrl, carrier: clean(b.carrier, 60) || null }
}

// ── Supplier settings (admin) ────────────────────────────────────────────────

export type SupplierInput = { ok: true; value: Omit<Supplier, 'id'> } | { ok: false; error: string }

const EMAIL = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i

export function parseSupplierInput(body: unknown): SupplierInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = clean(b.name, 80)
  if (name.length < 2) return { ok: false, error: 'Name is required.' }
  const slug = clean(b.slug, 40).toLowerCase() || foldText(name).replace(/ /g, '-').slice(0, 40)
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return { ok: false, error: 'Slug: a–z, 0–9 and dashes.' }
  let feedUrl = ''
  try {
    const u = new URL(clean(b.feedUrl, 1000))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol')
    if (u.username || u.password) return { ok: false, error: 'Put feed credentials in the query, not user:password@.' }
    feedUrl = u.toString()
  } catch {
    return { ok: false, error: 'Feed URL must be an http(s) address.' }
  }
  const format = clean(b.feedFormat, 10) || 'auto'
  if (!['auto', 'heureka', 'google', 'csv'].includes(format)) return { ok: false, error: 'Unknown feed format.' }
  const orderEmail = clean(b.orderEmail, 254).toLowerCase()
  if (!EMAIL.test(orderEmail)) return { ok: false, error: 'Order e-mail is not valid.' }
  const currency = (clean(b.currency, 3) || 'CZK').toUpperCase()
  if (!CURRENCY.test(currency)) return { ok: false, error: 'Currency: three letters, e.g. CZK.' }
  const wholesaleField = clean(b.wholesaleField, 60) || null
  if (wholesaleField && !/^[A-Za-z_][\w:.-]{0,59}$/.test(wholesaleField)) return { ok: false, error: 'Wholesale field: a tag or column name.' }
  const discountRaw = b.wholesaleDiscountPct === '' || b.wholesaleDiscountPct === null || b.wholesaleDiscountPct === undefined ? null : Number(b.wholesaleDiscountPct)
  if (discountRaw !== null && !(Number.isFinite(discountRaw) && discountRaw > 0 && discountRaw < 90)) return { ok: false, error: 'Discount: 1–89 %.' }
  const days = Number(b.dispatchDays ?? 2)
  if (!Number.isInteger(days) || days < 0 || days > 30) return { ok: false, error: 'Dispatch days: 0–30.' }
  const shipsTo = (Array.isArray(b.shipsTo) ? b.shipsTo : String(b.shipsTo ?? 'CZ').split(/[\s,]+/))
    .map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30)
  return {
    ok: true,
    value: {
      slug, name, status: b.status === 'paused' ? 'paused' : 'active', feed_url: feedUrl,
      feed_format: format as Supplier['feed_format'], wholesale_field: wholesaleField, wholesale_discount_pct: discountRaw,
      currency, order_email: orderEmail, dispatch_days: days, ships_to: shipsTo.length ? shipsTo : ['CZ'],
      note: clean(b.note, 500) || null,
    },
  }
}
