// GET /api/agent/v1/product?url=<product page> (or POST { url }) — one product page read into
// normalized product JSON for AI agents (price, currency, availability, brand, SKU, GTIN, images,
// rating), from the page's own structured data (lib/agents/product-tool.ts). $0.01 a call.
// Pay per call over x402 with no account (lib/agents/pay-per-call.ts), or Bearer qbx_… from a Qbox
// balance. Nothing is charged when the page can't be read or has no product data. Also an MCP tool
// (`lookup_product` on /api/mcp).
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { CORS, charge, paidCaller, reply } from '@/lib/agents/paid'
import { agentToolUsd } from '@/lib/agents/paid-price'
import { hasApiKey, payPerCall } from '@/lib/agents/pay-per-call'
import { PRODUCT_HTTP_TOOL, productUrl, readProduct } from '@/lib/agents/product-tool'

export const maxDuration = 30

const USAGE = 'Send ?url=<public product page> (GET) or { "url": "…" } (POST).'

async function handle(req: Request, rawUrl: unknown): Promise<NextResponse> {
  const url = productUrl(rawUrl)
  if (!url) return NextResponse.json({ error: USAGE }, { status: 400, headers: CORS })

  if (!hasApiKey(req)) return payPerCall(req, PRODUCT_HTTP_TOOL, () => readProduct(url))

  const c = await paidCaller(req)
  if (c instanceof NextResponse) return c
  if (!rateLimit(`agent-product:${c.member.userId}`, 600, 3_600_000).allowed) return reply(c, { error: 'At most 600 lookups an hour.' }, 429)
  const r = await readProduct(url)
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
