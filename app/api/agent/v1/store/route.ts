// GET /api/agent/v1/store?url=<store home page> (or POST { url }) — a store's profile for AI agents:
// contacts, company ids (IČO, EU VAT), address, socials, payment and shipping methods, links to its
// shipping / returns / terms / privacy pages (lib/agents/store-profile.ts). $0.01 a call, x402 with
// no account or Bearer qbx_…; not charged when the page can't be read. MCP: `profile_store`.
import { productUrl } from '@/lib/agents/product-tool'
import { readStoreProfile, STORE_HTTP_TOOL } from '@/lib/agents/agent-tools'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 30

function handle(req: Request, raw: unknown) {
  const url = productUrl(raw)
  if (!url) return badRequest('Send ?url=<public store address> (GET) or { "url": "…" } (POST).')
  return paidToolResponse(req, STORE_HTTP_TOOL, `store ${url.host}`, () => readStoreProfile(url))
}

export async function GET(req: Request) {
  return handle(req, new URL(req.url).searchParams.get('url'))
}

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { url?: unknown } | null
  return handle(req, body?.url)
}

export function OPTIONS() {
  return preflight()
}
