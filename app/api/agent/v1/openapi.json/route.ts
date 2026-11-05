// OpenAPI 3.1 of the read-only agent API (lib/agents/discovery.ts).
import { agentOpenApi } from '@/lib/agents/discovery'
import { agentHeaders } from '@/lib/agents/runtime'

export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(agentOpenApi(), null, 2), { headers: agentHeaders('application/json; charset=utf-8') })
}
