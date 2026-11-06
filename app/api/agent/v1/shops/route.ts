// GET /api/agent/v1/shops — the free directory of agent-ready stores (lib/agent-shops): every listed
// store with its /.well-known/agent-shop.json. ?country=CZ&limit=50&offset=0. Public, CORS open.
// Product search across them is paid: /api/agent/v1/shops/search. MCP: list_agent_shops.
import { agentHeaders } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'
import { RegistryUnavailable, listDirectory } from '@/lib/agent-shops/registry'
import { preflight } from '@/lib/agents/paid-route'

export const dynamic = 'force-dynamic'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: agentHeaders('application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=120, s-maxage=120' }),
  })

export async function GET(req: Request) {
  recordAgentVisit(req, 'api')
  const sp = new URL(req.url).searchParams
  const country = (sp.get('country') ?? '').toUpperCase()
  const limit = Math.max(1, Math.min(100, Math.floor(Number(sp.get('limit')) || 50)))
  const offset = Math.max(0, Math.floor(Number(sp.get('offset')) || 0))
  try {
    const d = await listDirectory({ country: /^[A-Z]{2}$/.test(country) ? country : null, limit, offset })
    return json({
      about: 'Online stores that describe themselves for AI agents (/.well-known/agent-shop.json): search, price and order through each store\'s own API or MCP server.',
      search: { url: new URL('/api/agent/v1/shops/search', req.url).href, paid: 'per call, x402 USDC (no account) or a Qbox balance; not charged when nothing is found' },
      ...d,
    })
  } catch (e) {
    if (e instanceof RegistryUnavailable) return json({ error: 'The registry of agent-ready stores is not open yet.', total: 0, shops: [] }, 503)
    return json({ error: 'The directory is unavailable right now.' }, 500)
  }
}

export function OPTIONS() {
  return preflight('GET, OPTIONS')
}
