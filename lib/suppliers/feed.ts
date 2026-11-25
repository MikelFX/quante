// Supplier catalog (CLAUDE.md §13r): reads a supplier's product feed. Pure — no imports beyond
// the Qscan text helpers, so the tests load it straight from the .ts file.
//
// Three formats cover practically every Czech wholesaler:
//   • heureka — the Heureka / Zboží.cz XML every Czech e-shop already exports (<SHOP><SHOPITEM>…)
//   • google  — Google Merchant RSS/Atom (<item> or <entry> with g: fields)
//   • csv     — a header row + one product a row (; , or tab separated)
// 'auto' sniffs the body. The feed is DATA from another company: every value is length-capped,
// HTML is stripped from text, and only http(s) image URLs survive.

import { cleanText, decodeEntities, parsePrice } from '../qscan/extract.ts'

export type FeedFormat = 'heureka' | 'google' | 'csv'

/** One product as the feed states it, before our catalog rules (model.ts normalizeItem). */
export interface FeedItem {
  externalId: string
  name: string
  description: string
  brand: string
  category: string
  images: string[]
  /** The supplier's own retail price incl. VAT (Heureka PRICE_VAT / Google price), major units. */
  retailPrice: number | null
  /** Wholesale price for the merchant, major units — only when the feed carries one. */
  wholesalePrice: number | null
  currency: string | null
  ean: string
  sku: string
  /** Pieces in stock; null = the feed does not say. */
  stock: number | null
  /** false only when the feed says so (out of stock / not orderable). */
  available: boolean
  /** Days until dispatch when the feed states it (Heureka DELIVERY_DATE as a number). */
  deliveryDays: number | null
  url: string
}

export interface FeedOptions {
  /** Tag / column that carries the wholesale price, when the supplier uses its own name for it. */
  wholesaleField?: string | null
  /** Stop after this many items (the importer's cap). */
  limit?: number
}

export const FEED_LIMITS = {
  items: 50_000,
  name: 200,
  description: 5_000,
  short: 120,
  images: 8,
} as const

// Names wholesalers use for the price the merchant pays, checked in this order.
const WHOLESALE_TAGS = [
  'PRICE_WHOLESALE', 'WHOLESALE_PRICE', 'PURCHASE_PRICE', 'PRICE_PURCHASE', 'NAKUPNI_CENA', 'CENA_NAKUPNI',
  'VOC', 'VOC_VAT', 'PRICE_VOC', 'PRICE_DEALER', 'DEALER_PRICE', 'B2B_PRICE', 'PRICE_B2B',
]
const STOCK_TAGS = ['STOCK_QUANTITY', 'QUANTITY', 'STOCK_AMOUNT', 'AMOUNT', 'STOCK', 'SKLADEM', 'MNOZSTVI']

export function detectFormat(body: string): FeedFormat {
  const head = body.slice(0, 4000)
  if (/<SHOPITEM\b/i.test(head) || /<SHOP\b/i.test(head)) return 'heureka'
  if (/<(rss|feed)\b/i.test(head) && /xmlns:g=|<g:/i.test(body.slice(0, 20000))) return 'google'
  if (/<item\b/i.test(head) || /<entry\b/i.test(head)) return 'google'
  return 'csv'
}

export function parseFeed(body: string, format: FeedFormat | 'auto', opts: FeedOptions = {}): FeedItem[] {
  const f = format === 'auto' ? detectFormat(body) : format
  const limit = Math.min(opts.limit ?? FEED_LIMITS.items, FEED_LIMITS.items)
  if (f === 'heureka') return parseHeureka(body, opts, limit)
  if (f === 'google') return parseGoogle(body, opts, limit)
  return parseCsv(body, opts, limit)
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function unCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Text of a tag's content: CDATA unwrapped, markup (scripts and styles whole) removed, entities decoded, whitespace folded. */
function text(raw: string, max: number = FEED_LIMITS.short): string {
  const s = unCdata(raw).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  return cleanText(s).slice(0, max)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Contents of every <name>…</name> directly in `xml` (case-insensitive; `name` may hold a prefix like g:). */
function all(xml: string, name: string): string[] {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, 'gi')
  const out: string[] = []
  for (const m of xml.matchAll(re)) out.push(m[1])
  return out
}

function first(xml: string, ...names: string[]): string {
  for (const n of names) {
    const v = all(xml, n)[0]
    if (v !== undefined && text(v, FEED_LIMITS.description)) return v
  }
  return ''
}

/** Blocks of one repeated element, without loading anything else. */
function blocks(xml: string, name: string, limit: number): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi')
  const out: string[] = []
  for (const m of xml.matchAll(re)) {
    out.push(m[1])
    if (out.length >= limit) break
  }
  return out
}

function httpUrl(raw: string): string | null {
  const s = decodeEntities(unCdata(raw).trim())
  if (!/^https?:\/\//i.test(s) || s.length > 1000 || /\s/.test(s)) return null
  try {
    const u = new URL(s)
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

function images(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const u = httpUrl(raw)
    if (u && !out.includes(u)) out.push(u)
    if (out.length >= FEED_LIMITS.images) break
  }
  return out
}

function int(raw: string): number | null {
  const s = text(raw).replace(/\s/g, '')
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return null
  const n = Math.floor(Number(s.replace(',', '.')))
  return Number.isFinite(n) ? Math.max(0, n) : null
}

function price(raw: string): number | null {
  const t = text(raw)
  if (!t) return null
  const n = parsePrice(t)
  return n !== null && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null
}

function currencyOf(raw: string): string | null {
  const m = text(raw).toUpperCase().match(/\b([A-Z]{3})\b/)
  if (m) return m[1]
  if (/Kč/i.test(raw)) return 'CZK'
  if (/€/.test(raw)) return 'EUR'
  return null
}

function wholesaleFrom(xml: string, field: string | null | undefined): number | null {
  const tags = field ? [field, ...WHOLESALE_TAGS] : WHOLESALE_TAGS
  for (const t of tags) {
    if (!/^[A-Za-z_][\w:.-]{0,60}$/.test(t)) continue
    const p = price(first(xml, t))
    if (p !== null) return p
  }
  return null
}

function stockFrom(xml: string): number | null {
  // Heureka availability feeds nest the amount: <STOCK><AMOUNT>12</AMOUNT></STOCK>
  for (const t of STOCK_TAGS) {
    const raw = first(xml, t)
    if (!raw) continue
    const n = int(raw.includes('<') ? first(raw, 'AMOUNT', 'QUANTITY') || raw : raw)
    if (n !== null) return n
  }
  return null
}

// ── Heureka / Zboží.cz ───────────────────────────────────────────────────────

function parseHeureka(xml: string, opts: FeedOptions, limit: number): FeedItem[] {
  const out: FeedItem[] = []
  for (const b of blocks(xml, 'SHOPITEM', limit)) {
    const delivery = int(first(b, 'DELIVERY_DATE'))
    const stock = stockFrom(b)
    const deliveryRaw = text(first(b, 'DELIVERY_DATE')).toLowerCase()
    const unavailable = /vyprod|nedostup|unavailable|out of stock/.test(deliveryRaw) || stock === 0
    const priceRaw = first(b, 'PRICE_VAT', 'PRICE')
    out.push({
      externalId: text(first(b, 'ITEM_ID', 'ID', 'CODE')),
      name: text(first(b, 'PRODUCTNAME', 'PRODUCT', 'NAME'), FEED_LIMITS.name),
      description: text(first(b, 'DESCRIPTION'), FEED_LIMITS.description),
      brand: text(first(b, 'MANUFACTURER', 'BRAND')),
      category: text(first(b, 'CATEGORYTEXT', 'CATEGORY')),
      images: images([...all(b, 'IMGURL'), ...all(b, 'IMGURL_ALTERNATIVE')]),
      retailPrice: price(priceRaw),
      wholesalePrice: wholesaleFrom(b, opts.wholesaleField),
      currency: currencyOf(first(b, 'CURRENCY')) ?? currencyOf(priceRaw),
      ean: text(first(b, 'EAN', 'GTIN')).replace(/\D/g, '').slice(0, 14),
      sku: text(first(b, 'PRODUCTNO', 'SKU', 'CODE')).slice(0, 64),
      stock,
      available: !unavailable,
      deliveryDays: delivery !== null && delivery <= 60 ? delivery : null,
      url: httpUrl(first(b, 'URL')) ?? '',
    })
  }
  return out
}

// ── Google Merchant ──────────────────────────────────────────────────────────

function parseGoogle(xml: string, opts: FeedOptions, limit: number): FeedItem[] {
  const items = blocks(xml, 'item', limit)
  const list = items.length ? items : blocks(xml, 'entry', limit)
  const out: FeedItem[] = []
  for (const b of list) {
    const priceRaw = first(b, 'g:sale_price', 'g:price', 'price')
    const availability = text(first(b, 'g:availability')).toLowerCase().replace(/\s+/g, '_')
    const stock = int(first(b, 'g:quantity', 'g:sell_on_google_quantity'))
    const category = text(first(b, 'g:product_type', 'g:google_product_category'))
    out.push({
      externalId: text(first(b, 'g:id', 'id', 'g:mpn')),
      name: text(first(b, 'g:title', 'title'), FEED_LIMITS.name),
      description: text(first(b, 'g:description', 'description', 'summary'), FEED_LIMITS.description),
      brand: text(first(b, 'g:brand')),
      category: category.split('>').map((s) => s.trim()).filter(Boolean).join(' | '),
      images: images([...all(b, 'g:image_link'), ...all(b, 'g:additional_image_link')]),
      retailPrice: price(priceRaw),
      wholesalePrice: wholesaleFrom(b, opts.wholesaleField ? opts.wholesaleField : 'g:cost_of_goods_sold'),
      currency: currencyOf(priceRaw),
      ean: text(first(b, 'g:gtin')).replace(/\D/g, '').slice(0, 14),
      sku: text(first(b, 'g:mpn', 'g:sku')).slice(0, 64),
      stock,
      available: !/out_of_stock|discontinued/.test(availability) && stock !== 0,
      deliveryDays: null,
      url: httpUrl(first(b, 'g:link', 'link')) ?? '',
    })
  }
  return out
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const CSV_COLUMNS: Record<keyof Omit<FeedItem, 'images' | 'available' | 'currency'> | 'image' | 'images2' | 'availability' | 'currency', string[]> = {
  externalId: ['id', 'item_id', 'code', 'kod', 'product_id'],
  name: ['name', 'title', 'nazev', 'productname', 'product'],
  description: ['description', 'popis'],
  brand: ['brand', 'manufacturer', 'vyrobce', 'znacka'],
  category: ['category', 'categorytext', 'kategorie', 'product_type'],
  image: ['image', 'image_url', 'imgurl', 'image_link', 'obrazek', 'foto'],
  images2: ['images', 'additional_images', 'imgurl_alternative', 'additional_image_link'],
  retailPrice: ['price', 'price_vat', 'retail_price', 'cena', 'mo_cena', 'moc'],
  wholesalePrice: ['wholesale_price', 'price_wholesale', 'purchase_price', 'nakupni_cena', 'voc', 'dealer_price', 'b2b_price'],
  currency: ['currency', 'mena'],
  ean: ['ean', 'gtin', 'barcode'],
  sku: ['sku', 'productno', 'mpn'],
  stock: ['stock', 'quantity', 'stock_quantity', 'skladem', 'mnozstvi'],
  availability: ['availability', 'dostupnost'],
  deliveryDays: ['delivery_days', 'delivery_date', 'dodani'],
  url: ['url', 'link'],
}

/** RFC 4180-ish: quoted fields with "" escapes, newlines inside quotes, ; , or tab separator. */
export function csvRows(body: string, maxRows: number): string[][] {
  const src = body.replace(/^\uFEFF/, '')
  const nl = src.search(/\r?\n/)
  const headerLine = nl === -1 ? src : src.slice(0, nl)
  const counts = { ';': 0, ',': 0, '\t': 0 } as Record<string, number>
  for (const ch of headerLine) if (ch in counts) counts[ch]++
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { quoted = true; continue }
    if (ch === sep) { row.push(field); field = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      if (rows.length > maxRows) break
      continue
    }
    field += ch
  }
  if (field || row.length) { row.push(field); if (row.some((c) => c.trim())) rows.push(row) }
  return rows
}

function parseCsv(body: string, opts: FeedOptions, limit: number): FeedItem[] {
  const rows = csvRows(body, limit)
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  const col = (key: keyof typeof CSV_COLUMNS): number => {
    if (key === 'wholesalePrice' && opts.wholesaleField) {
      const i = header.indexOf(opts.wholesaleField.trim().toLowerCase())
      if (i >= 0) return i
    }
    for (const name of CSV_COLUMNS[key]) {
      const i = header.indexOf(name)
      if (i >= 0) return i
    }
    return -1
  }
  const idx = Object.fromEntries((Object.keys(CSV_COLUMNS) as Array<keyof typeof CSV_COLUMNS>).map((k) => [k, col(k)])) as Record<keyof typeof CSV_COLUMNS, number>
  const get = (r: string[], k: keyof typeof CSV_COLUMNS) => (idx[k] >= 0 ? (r[idx[k]] ?? '') : '')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const out: FeedItem[] = []
  for (const r of rows.slice(1, limit + 1)) {
    const stock = int(esc(get(r, 'stock')))
    const availability = get(r, 'availability').toLowerCase()
    const extra = get(r, 'images2').split(/[|,\s]+/).filter(Boolean)
    const priceRaw = get(r, 'retailPrice')
    out.push({
      externalId: text(esc(get(r, 'externalId'))),
      name: text(esc(get(r, 'name')), FEED_LIMITS.name),
      description: text(get(r, 'description'), FEED_LIMITS.description),
      brand: text(esc(get(r, 'brand'))),
      category: text(esc(get(r, 'category'))),
      images: images([get(r, 'image'), ...extra]),
      retailPrice: price(esc(priceRaw)),
      wholesalePrice: price(esc(get(r, 'wholesalePrice'))),
      currency: currencyOf(esc(get(r, 'currency'))) ?? currencyOf(esc(priceRaw)),
      ean: get(r, 'ean').replace(/\D/g, '').slice(0, 14),
      sku: text(esc(get(r, 'sku'))).slice(0, 64),
      stock,
      available: !/out|vyprod|nedostup|^0$|^no$|^ne$/.test(availability) && stock !== 0,
      deliveryDays: (() => { const d = int(esc(get(r, 'deliveryDays'))); return d !== null && d <= 60 ? d : null })(),
      url: httpUrl(get(r, 'url')) ?? '',
    })
  }
  return out
}
