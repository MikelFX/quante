// GET /api/agent/v1/pages — every public page with its canonical and Markdown URL.
import { agentPages } from '@/lib/agents/pages'
import { agentHeaders, agentRuntime } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export function GET(req: Request) {
  recordAgentVisit(req, 'api')
  const pages = agentPages(agentRuntime()).map((p) => ({ id: p.id, title: p.title, url: p.url, markdown: p.md }))
  return new Response(JSON.stringify(pages, null, 2), { headers: agentHeaders('application/json; charset=utf-8') })
}
