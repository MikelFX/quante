// GET /api/agent/v1/product?url=<product page> (or POST { url }) — one product page read into
// normalized product JSON for AI agents (price, currency, availability, brand, SKU, GTIN, images,
// rating), from the page's own structured data (lib/agents/product.ts). $0.01 a call.
// Pay per call over x402 with no account (lib/agents/pay-per-call.ts), or Bearer qbx_… from a Qbox
// balance. Nothing is charged when the page can't be read or has no product data. Sites that block
// bots get an honest error — never worked around. The page is fetched once, through Qscan's
// SSRF-safe fetcher; nothing is stored or copied.
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeScanUrl } from '@/lib/qscan/net'
import { ScanFetchError, scanFetch } from '@/lib/qscan/fetch'
import { lookupProduct } from '@/lib/agents/product'
import { CORS, charge, paidCaller, reply } from '@/lib/agents/paid'
import { agentToolUsd } from '@/lib/agents/paid-price'
import { hasApiKey, payPerCall, type Work } from '@/lib/agents/pay-per-call'

export const maxDuration = 30

const USAGE = 'Send ?url=<public product page> (GET) or { "url": "…" } (POST).'

async function read(url: URL): Promise<Work> {
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

async function handle(req: Request, rawUrl: unknown): Promise<NextResponse> {
  const url = typeof rawUrl === 'string' ? normalizeScanUrl(rawUrl) : null
  if (!url) return NextResponse.json({ error: USAGE }, { status: 400, headers: CORS })

  if (!hasApiKey(req)) {
    return payPerCall(req, {
      tool: 'product',
      description: 'Product page → normalized product JSON (price, currency, availability, brand, SKU, GTIN, images, rating)',
      input: { method: req.method, queryParams: { url: { type: 'string', description: 'Public product page URL', required: true } } },
      output: { type: 'object', properties: { found: { type: 'boolean' }, source: { type: 'string' }, products: { type: 'array' } } },
      perIpHour: 600,
    }, () => read(url))
  }

  const c = await paidCaller(req)
  if (c instanceof NextResponse) return c
  if (!rateLimit(`agent-product:${c.member.userId}`, 600, 3_600_000).allowed) return reply(c, { error: 'At most 600 lookups an hour.' }, 429)
  const r = await read(url)
  if (!r.ok) return reply(c, { ...r.body, charged: false }, r.status)
  const booked = await charge(c, 'product', `product ${url.host}`)
  if (!booked.ok) return booked.response
  return reply(c, { ...r.body, charged: { usd: agentToolUsd('product') } })
}

export async function GET(req: Request) {
  return handle(req, new URL(req.url).searchParams.get('url'))
}

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { url?: unknown } | null
  return handle(req, body?.url)
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } })
}
