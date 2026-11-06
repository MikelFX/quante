// GET /api/agent/v1/stats — the public agent numbers (lib/agents/stats.ts): agents welcomed, agents
// that paid, paid calls, sellers (null until the Qbox services marketplace). Public, CORS open, no key,
// cached a minute. Shown on quantecode.com ("Agenti u nás") and listed in the catalog and llms.txt.
import { agentStats } from '@/lib/agents/stats'
import { agentHeaders } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  recordAgentVisit(req, 'api')
  const s = await agentStats()
  return new Response(JSON.stringify(s, null, 2), {
    headers: agentHeaders('application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' }),
  })
}
