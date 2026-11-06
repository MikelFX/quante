// GET /api/agent/v1/search?q=…&limit=5 — keyword search over every page (no model, no cost).
import { searchPages } from '@/lib/agents/discovery'
import { agentPages } from '@/lib/agents/pages'
import { agentHeaders, agentRuntime, qboxLlms } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export function GET(req: Request) {
  recordAgentVisit(req, 'api')
  const u = new URL(req.url)
  const q = (u.searchParams.get('q') ?? '').slice(0, 200)
  const limit = Number(u.searchParams.get('limit') ?? 5)
  const hits = searchPages(q, agentPages(agentRuntime(), qboxLlms()), Number.isFinite(limit) ? limit : 5)
  return new Response(JSON.stringify({ query: q, hits }, null, 2), { headers: agentHeaders('application/json; charset=utf-8') })
}
