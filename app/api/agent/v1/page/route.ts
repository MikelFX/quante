// GET /api/agent/v1/page?url=<url or path> — one page as Markdown. The proxy also rewrites page
// requests with `Accept: text/markdown` or a ".md" suffix here (?path=…, the host decides which page).
import { hostKind } from '@/lib/domains'
import { agentPage, agentPageFor, agentPageId } from '@/lib/agents/pages'
import { agentHeaders, agentRuntime, qboxLlms, requestHost } from '@/lib/agents/runtime'
import { recordAgentVisit } from '@/lib/agents/visits-record'

export function GET(req: Request) {
  recordAgentVisit(req, 'markdown')
  const u = new URL(req.url)
  const rt = agentRuntime()
  const path = req.headers.get('x-agent-path') ?? u.searchParams.get('path')
  const page = path !== null
    ? (() => { const id = agentPageId(path, hostKind(requestHost(req))); return id ? agentPage(id, rt, qboxLlms()) : null })()
    : agentPageFor(u.searchParams.get('url') ?? '', rt, qboxLlms())
  if (!page) {
    return new Response('# Not found\n\nNo Markdown for this page. List: https://quantecode.com/api/agent/v1/pages\n', { status: 404, headers: agentHeaders('text/markdown; charset=utf-8') })
  }
  return new Response(page.markdown, {
    headers: agentHeaders('text/markdown; charset=utf-8', { Link: `<${page.url}>; rel="canonical"`, Vary: 'Accept' }),
  })
}
