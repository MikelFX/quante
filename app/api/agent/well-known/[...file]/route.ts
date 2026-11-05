// /.well-known/* for agents (next.config.ts rewrite): api-catalog (RFC 9727), mcp.json, the MCP
// server card, llms.txt.
import { hostKind } from '@/lib/domains'
import { apiCatalog, llmsTxt, mcpIndex, mcpServerCard } from '@/lib/agents/discovery'
import { SITE_MCP_TOOLS } from '@/lib/agents/mcp'
import { agentHeaders, agentRuntime, requestHost } from '@/lib/agents/runtime'

const j = (v: unknown, type = 'application/json; charset=utf-8') => new Response(JSON.stringify(v, null, 2), { headers: agentHeaders(type) })

export async function GET(req: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const file = (await params).file.join('/')
  switch (file) {
    case 'api-catalog': return j(apiCatalog(), 'application/linkset+json')
    case 'mcp.json': return j(mcpIndex())
    case 'mcp/server-card.json':
    case 'mcp/server.json': return j(mcpServerCard([...SITE_MCP_TOOLS]))
    case 'llms.txt': return new Response(llmsTxt(hostKind(requestHost(req)), agentRuntime()), { headers: agentHeaders('text/plain; charset=utf-8') })
    default: return new Response('Not found', { status: 404 })
  }
}

export function HEAD(req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  return GET(req, ctx).then((r) => new Response(null, { status: r.status, headers: r.headers }))
}
