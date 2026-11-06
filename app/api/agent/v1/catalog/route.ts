// GET /api/agent/v1/catalog — the whole offer for AI agents (lib/agents/catalog.ts). Public, CORS open.
import { agentCatalog } from '@/lib/agents/catalog'
import { agentHeaders, agentRuntime } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export function GET(req: Request) {
  recordAgentVisit(req, 'api')
  return new Response(JSON.stringify(agentCatalog(agentRuntime()), null, 2), { headers: agentHeaders('application/json; charset=utf-8') })
}
