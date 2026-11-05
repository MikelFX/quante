// GET /api/agent/v1/check?url=<store home page> (or POST { url }) — the Qgent rule checks (no model)
// over a store's home page and one product page, as findings in English. $0.02 a call, x402 with no
// account or Bearer qbx_…; not charged when the page can't be read. The full review by 20 AI
// agents is POST /api/agent/v1/review. MCP: `check_store`.
import { productUrl } from '@/lib/agents/product-tool'
import { CHECK_HTTP_TOOL, quickCheck } from '@/lib/agents/agent-tools'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 40

function handle(req: Request, raw: unknown) {
  const url = productUrl(raw)
  if (!url) return badRequest('Send ?url=<public store address> (GET) or { "url": "…" } (POST).')
  return paidToolResponse(req, CHECK_HTTP_TOOL, `check ${url.host}`, () => quickCheck(url))
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
