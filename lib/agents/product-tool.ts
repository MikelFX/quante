// The product lookup as a paid tool (server only): fetch one product page through Qscan's SSRF-safe
// fetcher and read it with lib/agents/product.ts. Shared by GET /api/agent/v1/product and the site
// MCP server's `lookup_product` tool. Nothing is stored or copied; sites that block bots get an
// honest error — never worked around. No product data = a failed call (nothing is charged).
import { normalizeScanUrl } from '@/lib/qscan/net'
import { ScanFetchError, scanFetch } from '@/lib/qscan/fetch'
import { lookupProduct } from './product'
import { LOOKUP_PRODUCT_INPUT } from './mcp'
import type { Work } from './pay-per-call'
import type { PayPerCallTool } from './pay-per-call-offer'

export const PRODUCT_EXAMPLE = {
  url: 'https://www.allbirds.com/products/mens-tree-runners', found: true, source: 'json-ld', platform: 'shopify',
  products: [{ name: "Men's Tree Runner", brand: 'Allbirds', sku: 'MENS_TREE_RUNNERS', gtin: null, price: 100, currency: 'USD', availability: 'in_stock', condition: 'new' }],
}

const DESCRIPTION = 'Product page → normalized product JSON (price, currency, availability, brand, SKU, GTIN, images, rating)'
const TAGS = ['ecommerce', 'product-data', 'prices', 'shopping', 'scraping']


export const PRODUCT_HTTP_TOOL: PayPerCallTool = {
  tool: 'product',
  description: DESCRIPTION,
  call: { method: 'GET', query: { url: { description: 'Public product page URL', example: PRODUCT_EXAMPLE.url } } },
  outputExample: PRODUCT_EXAMPLE,
  tags: TAGS,
  perIpHour: 600,
}

export const PRODUCT_MCP_TOOL: PayPerCallTool = {
  ...PRODUCT_HTTP_TOOL,
  call: { method: 'MCP', toolName: 'lookup_product', description: DESCRIPTION, inputSchema: LOOKUP_PRODUCT_INPUT, example: { url: PRODUCT_EXAMPLE.url } },
}

/** The URL argument → a checked public URL, or null. */
export const productUrl = (raw: unknown) => (typeof raw === 'string' ? normalizeScanUrl(raw) : null)

/** Reads one product page. */
export async function readProduct(url: URL): Promise<Work> {
  let res
  try {
    res = await scanFetch(url, { timeoutMs: 12_000, maxBytes: 3 * 1024 * 1024, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' })
  } catch (err) {
    return { ok: false, status: 422, body: { error: err instanceof ScanFetchError ? err.message : 'Could not read the page.' } }
  }
  if (res.status === 403 || res.status === 429 || res.status === 503) {
    return { ok: false, status: 422, body: { error: `The site refused automated reading (HTTP ${res.status}). We don't work around bot protection.` } }
  }
  if (res.status !== 200) return { ok: false, status: 422, body: { error: `The page answered HTTP ${res.status}.` } }
  if (!/html/i.test(res.contentType)) return { ok: false, status: 422, body: { error: 'The address is not an HTML page.' } }
  const r = lookupProduct(res.body.toString('utf8'), res.url)
  if (!r.found) {
    return { ok: false, status: 422, body: { error: 'No structured product data on this page (JSON-LD, microdata or OpenGraph). Try the product\'s own page.', url: r.url, platform: r.platform } }
  }
  return { ok: true, body: { ...r } }
}
