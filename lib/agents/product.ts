// Product lookup for AI agents (pure, no I/O): one product page's HTML → normalized product JSON
// (name, price, currency, availability, brand, SKU, GTIN, images, rating …). Shopping, price-watch
// and comparison agents call this per product URL and pay per call (lib/agents/pay-per-call.ts).
// Reads only what the page publishes for machines — schema.org JSON-LD, microdata, OpenGraph
// product tags — the same structured data search engines read. Built on Qscan's extractors.
// Tested in __tests__/agent-product.test.mjs.
import {
  absUrl, attr, cleanText, detectPlatform, extractJsonLd, extractPage, parsePrice,
  productFromMicrodata, productsFromJsonLd, type ScanPlatform, type ScanProduct,
} from '@/lib/qscan/extract'

type Json = Record<string, unknown>

export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'limited' | 'discontinued'

export interface AgentProduct {
  name: string
  description: string
  brand: string | null
  sku: string | null
  gtin: string | null
  mpn: string | null
  price: number | null
  currency: string | null
  availability: Availability | null
  condition: 'new' | 'used' | 'refurbished' | 'damaged' | null
  images: string[]
  url: string
  category: string | null
  variants: string[]
  rating: { value: number; count: number | null } | null
}

export interface ProductLookup {
  url: string
  found: boolean
  /** where the data came from: the page's own structured data, never a guess */
  source: 'json-ld' | 'microdata' | 'opengraph' | null
  platform: ScanPlatform
  site: { name: string | null; title: string; language: string | null }
  products: AgentProduct[]
}

export const MAX_PRODUCTS = 10

/** schema.org availability (URL, bare or plain words) → our enum. */
export function normalizeAvailability(v: unknown): Availability | null {
  const s = (typeof v === 'string' ? v : '').toLowerCase().replace(/^https?:\/\/schema\.org\//, '').replace(/[\s_-]/g, '')
  if (!s) return null
  if (/^(instock|onlineonly|instoreonly|available|skladem)$/.test(s)) return 'in_stock'
  if (/^(outofstock|soldout|unavailable|vyprodano)$/.test(s)) return 'out_of_stock'
  if (/^(preorder|presale)$/.test(s)) return 'preorder'
  if (/^backorder$/.test(s)) return 'backorder'
  if (/^limitedavailability$/.test(s)) return 'limited'
  if (/^discontinued$/.test(s)) return 'discontinued'
  return null
}

function normalizeCondition(v: unknown): AgentProduct['condition'] {
  const s = (typeof v === 'string' ? v : '').toLowerCase().replace(/^https?:\/\/schema\.org\//, '')
  if (s.startsWith('new')) return 'new'
  if (s.startsWith('used')) return 'used'
  if (s.startsWith('refurbished')) return 'refurbished'
  if (s.startsWith('damaged')) return 'damaged'
  return null
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return cleanText(v)
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object' && !Array.isArray(v) && 'name' in (v as Json)) return text((v as Json).name)
  if (Array.isArray(v)) return text(v[0])
  return ''
}
const orNull = (s: string, max = 200) => (s ? s.slice(0, max) : null)

function types(o: Json): string[] {
  const t = o['@type']
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase())
}

function offersOf(o: Json): Json[] {
  const raw = o.offers
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Json[]
  // AggregateOffer may nest its own offers
  return list.flatMap((of) => (of && Array.isArray(of.offers) ? [of, ...(of.offers as Json[])] : [of])).filter((x) => x && typeof x === 'object')
}

function gtinOf(o: Json): string | null {
  for (const k of ['gtin13', 'gtin', 'gtin14', 'gtin12', 'gtin8', 'isbn']) {
    const v = text(o[k]).replace(/\s/g, '')
    if (/^\d{8,14}$/.test(v)) return v
  }
  return null
}

function ratingOf(o: Json): AgentProduct['rating'] {
  const r = o.aggregateRating as Json | undefined
  if (!r || typeof r !== 'object') return null
  const value = parsePrice(r.ratingValue)
  if (value === null) return null
  const count = parsePrice(r.reviewCount ?? r.ratingCount)
  return { value, count: count === null ? null : Math.round(count) }
}

function fromBase(b: ScanProduct, pageUrl: string): AgentProduct {
  return {
    name: b.name.slice(0, 300), description: b.description, brand: null, sku: null, gtin: null, mpn: null,
    price: b.price, currency: b.currency, availability: null, condition: null, images: b.images.slice(0, 12),
    url: b.url ?? pageUrl, category: b.category, variants: b.variants, rating: null,
  }
}

/** JSON-LD Product / ProductGroup objects, with the fields Qscan's extractor leaves out. */
export function productsFromLd(objs: Json[], pageUrl: string): AgentProduct[] {
  const out: AgentProduct[] = []
  for (const o of objs) {
    if (!types(o).some((t) => t === 'product' || t === 'productgroup')) continue
    const base = productsFromJsonLd([o], pageUrl)[0]
    if (!base) continue
    const p = fromBase(base, pageUrl)
    const offers = offersOf(o)
    const variantOffers = Array.isArray(o.hasVariant) ? (o.hasVariant as Json[]).flatMap((v) => (v && typeof v === 'object' ? offersOf(v) : [])) : []
    const all = [...offers, ...variantOffers]
    p.brand = orNull(text(o.brand ?? o.manufacturer))
    p.sku = orNull(text(o.sku), 100)
    p.mpn = orNull(text(o.mpn), 100)
    p.gtin = gtinOf(o) ?? (Array.isArray(o.hasVariant) ? gtinOf(((o.hasVariant as Json[])[0] ?? {}) as Json) : null)
    // in stock when any offer is; otherwise the first stated state
    const states = all.map((of) => normalizeAvailability(of.availability)).filter((x): x is Availability => x !== null)
    p.availability = states.includes('in_stock') ? 'in_stock' : states[0] ?? null
    p.condition = normalizeCondition(all.map((of) => of.itemCondition).find(Boolean) ?? o.itemCondition)
    p.rating = ratingOf(o)
    if (!p.currency) {
      const c = all.map((of) => text(of.priceCurrency)).find((x) => /^[A-Z]{3}$/.test(x))
      if (c) p.currency = c
    }
    out.push(p)
  }
  return out
}

/** `<meta property|name="key" content="…">` → content ('' when missing). */
function meta(html: string, key: string): string {
  const re = /<meta\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[0]
    if ((attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop')).toLowerCase() === key) return attr(tag, 'content')
  }
  return ''
}

/** OpenGraph product tags (Facebook / Pinterest catalogues). */
export function productFromOpenGraph(html: string, pageUrl: string): AgentProduct | null {
  const price = parsePrice(meta(html, 'product:price:amount') || meta(html, 'og:price:amount'))
  const isProduct = /product/i.test(meta(html, 'og:type'))
  if (price === null && !isProduct) return null
  const name = cleanText(meta(html, 'og:title'))
  if (!name) return null
  const currency = (meta(html, 'product:price:currency') || meta(html, 'og:price:currency')).toUpperCase()
  const image = absUrl(meta(html, 'og:image') || meta(html, 'og:image:url'), pageUrl)
  return {
    name: name.slice(0, 300), description: cleanText(meta(html, 'og:description')).slice(0, 1200),
    brand: orNull(cleanText(meta(html, 'product:brand') || meta(html, 'og:brand'))),
    sku: orNull(cleanText(meta(html, 'product:retailer_item_id')), 100),
    gtin: /^\d{8,14}$/.test(meta(html, 'product:gtin')) ? meta(html, 'product:gtin') : null,
    mpn: null, price, currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    availability: normalizeAvailability(meta(html, 'product:availability') || meta(html, 'og:availability')),
    condition: normalizeCondition(meta(html, 'product:condition')),
    images: image ? [image] : [], url: absUrl(meta(html, 'og:url'), pageUrl) ?? pageUrl,
    category: null, variants: [], rating: null,
  }
}

/** The whole lookup: JSON-LD first, then microdata, then OpenGraph; gaps filled from OpenGraph. */
export function lookupProduct(html: string, pageUrl: string): ProductLookup {
  const page = extractPage(html, pageUrl)
  const og = productFromOpenGraph(html, pageUrl)
  let source: ProductLookup['source'] = null
  let products = productsFromLd(extractJsonLd(html), pageUrl)
  if (products.length) source = 'json-ld'
  if (!products.length) {
    const h1 = cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
    const md = productFromMicrodata(html, pageUrl, h1)
    if (md) {
      const p = fromBase(md, pageUrl)
      const av = html.match(/<\w+\b[^>]*\sitemprop\s*=\s*["']availability["'][^>]*>/i)?.[0]
      if (av) p.availability = normalizeAvailability(attr(av, 'href') || attr(av, 'content'))
      products = [p]
      source = 'microdata'
    }
  }
  if (!products.length && og) { products = [og]; source = 'opengraph' }
  // fill gaps of the main product from OpenGraph / the page
  if (products.length && og && source !== 'opengraph') {
    const p = products[0]
    p.currency ??= og.currency
    p.price ??= og.price
    p.availability ??= og.availability
    p.brand ??= og.brand
    if (!p.images.length) p.images = og.images
  }
  for (const p of products) p.currency ??= page.currencyHint
  return {
    url: pageUrl,
    found: products.length > 0,
    source,
    platform: detectPlatform(html),
    site: { name: page.siteName || null, title: page.title, language: page.lang || null },
    products: products.slice(0, MAX_PRODUCTS),
  }
}
