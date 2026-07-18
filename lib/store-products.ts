// Server-only. Parse and serialize the generated store's data/products.ts.
// Products live inside code_versions.files['data/products.ts'] as a TS array literal.

import JSON5 from 'json5'
import type { StoreProduct } from '@/types/store-code'

export const PRODUCTS_FILE = 'data/products.ts'

// Extracts the `products = [...]` array literal and parses it with JSON5
// (tolerates unquoted keys, single quotes, trailing commas). No code execution.
// Returns null when the file deviates too far from a plain literal (e.g. template
// strings or expressions) — callers must degrade gracefully to AI editing.
export function parseProductsFile(content: string): StoreProduct[] | null {
  const assignMatch = content.match(/products\s*(?::\s*[A-Za-z0-9_$[\]<>,.\s]+)?=\s*\[/)
  if (!assignMatch || assignMatch.index === undefined) return null

  const start = assignMatch.index + assignMatch[0].length - 1
  let depth = 0
  let end = -1
  let inString: string | null = null
  let escaped = false

  for (let i = start; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  const literal = content.slice(start, end + 1)
  try {
    const parsed: unknown = JSON5.parse(literal)
    if (!Array.isArray(parsed)) return null
    const products = parsed.filter(isStoreProductLike)
    // If filtering dropped entries the file contains non-literal values — unsafe to rewrite
    if (products.length !== parsed.length) return null
    return products
  } catch {
    return null
  }
}

function isStoreProductLike(p: unknown): p is StoreProduct {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.price === 'number' &&
    typeof o.slug === 'string' &&
    Array.isArray(o.images)
  )
}

export function sanitizeProduct(input: Record<string, unknown>): StoreProduct | null {
  if (typeof input.name !== 'string' || !input.name.trim()) return null
  const price = Number(input.price)
  if (!Number.isFinite(price) || price < 0) return null

  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const product: StoreProduct = {
    id: str(input.id).trim() || crypto.randomUUID().slice(0, 8),
    name: input.name.trim().slice(0, 200),
    description: str(input.description).slice(0, 5000),
    price,
    images: Array.isArray(input.images)
      ? input.images.filter((i): i is string => typeof i === 'string' && /^https?:\/\//.test(i)).slice(0, 8)
      : [],
    slug: (str(input.slug).trim() || input.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100),
    available: input.available !== false,
  }

  const compareAt = Number(input.compareAtPrice)
  if (Number.isFinite(compareAt) && compareAt > 0) product.compareAtPrice = compareAt
  if (typeof input.sku === 'string' && input.sku.trim()) product.sku = input.sku.trim().slice(0, 64)
  if (Array.isArray(input.tags)) {
    const tags = input.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim().slice(0, 40)).slice(0, 20)
    if (tags.length) product.tags = tags
  }
  if (Array.isArray(input.variants)) {
    const variants = input.variants
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
      .map(v => {
        const out: NonNullable<StoreProduct['variants']>[number] = {
          id: str(v.id).trim() || crypto.randomUUID().slice(0, 8),
          name: str(v.name).trim().slice(0, 100),
        }
        const vPrice = Number(v.price)
        if (Number.isFinite(vPrice) && vPrice >= 0) out.price = vPrice
        const vStock = Number(v.stock)
        if (Number.isFinite(vStock) && vStock >= 0) out.stock = Math.floor(vStock)
        if (typeof v.sku === 'string' && v.sku.trim()) out.sku = v.sku.trim().slice(0, 64)
        return out
      })
      .filter(v => v.name)
    if (variants.length) product.variants = variants
  }
  const threshold = Number(input.lowStockThreshold)
  if (Number.isFinite(threshold) && threshold >= 0) product.lowStockThreshold = Math.floor(threshold)

  return product
}

export function serializeProductsFile(products: StoreProduct[]): string {
  return [
    `import type { StoreProduct } from '@/types/store-code'`,
    ``,
    `export const products: StoreProduct[] = ${JSON.stringify(products, null, 2)}`,
    ``,
  ].join('\n')
}
