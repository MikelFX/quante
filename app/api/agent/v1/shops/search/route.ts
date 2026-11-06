// GET /api/agent/v1/shops/search?q=…&country=&currency=&maxPrice=&inStock=1&limit= (or POST the same
// as JSON) — products across every agent-ready store in the registry (lib/agent-shops). $0.01 a
// call, x402 with no account or Bearer qbx_…; not charged when nothing is found. MCP: find_products.
import { parseSearch } from '@/lib/agent-shops/model'
import { SHOPS_HTTP_TOOL, findProducts } from '@/lib/agent-shops/tool'
import { badRequest, paidToolResponse, preflight } from '@/lib/agents/paid-route'

export const maxDuration = 20

function handle(req: Request, input: Record<string, unknown>) {
  const f = parseSearch(input)
  if (!f.ok) return badRequest(f.error)
  return paidToolResponse(req, SHOPS_HTTP_TOOL, `shops "${f.value.q.slice(0, 60)}"`, () => findProducts(f.value))
}

export async function GET(req: Request) {
  return handle(req, Object.fromEntries(new URL(req.url).searchParams))
}

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null)
  return handle(req, body && typeof body === 'object' ? body as Record<string, unknown> : {})
}

export function OPTIONS() {
  return preflight()
}
