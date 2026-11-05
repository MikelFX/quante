// The site MCP server (Model Context Protocol, Streamable HTTP, stateless JSON): everything on
// assetradigital.agency + quantecode.com for agents, read-only and without a key. Tools never
// change, order or run anything — Qbox (its own MCP server, paid) is the place for that.
// JSON-RPC handling is pure here; the route injects the changelog loader. Tested in
// __tests__/agents.test.mjs.

import { AGENT_LINKS, agentCatalog, type AgentRuntime } from './catalog'
import { agentPageFor, agentPages } from './pages'
import { searchPages } from './discovery'

export const MCP_SERVER = { name: 'assetradigital', title: 'AssetraDigital + Quante — site knowledge', version: '1.0.0' }
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const MCP_INSTRUCTIONS =
  'AssetraDigital (Czech company: AI solutions, custom software, websites and e-shops) and its products Quante (AI e-shop builder, quantecode.com) '
  + 'and Qbox (sandboxes for AI agents). Use get_catalog for products and exact prices, search_site or read_page for details, get_contact to reach people. '
  + 'Facts that are null are not published yet: say so, never guess. Pages are Czech. To RUN code, use the Qbox MCP server at '
  + `${AGENT_LINKS.qbox.mcp} (paid, API key).`

export const SITE_MCP_TOOLS = [
  {
    name: 'get_catalog',
    description: 'Every product and service of AssetraDigital, Quante and Qbox with status and exact prices (computed from the billing code), contact and what is not published yet. Optional section filter.',
    inputSchema: { type: 'object', properties: { section: { type: 'string', enum: ['all', 'services', 'quante', 'qbox', 'pricing'], default: 'all' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_pages',
    description: 'Every public page with its canonical URL and Markdown URL.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_page',
    description: 'One page as Markdown. Pass its URL, path (e.g. "/web-eshop", "https://quantecode.com/quante/qads") or id from list_pages.',
    inputSchema: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'search_site',
    description: 'Keyword search over every page (Czech or English words, diacritics ignored). Returns sections with excerpts and URLs.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_changelog',
    description: 'Latest published product changes of Quante (newest first).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_contact',
    description: 'How a person reaches AssetraDigital (form, phone, e-mail; null = not published yet) and where to start in Quante.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const

export type ChangelogEntry = { date: string; title: string; description: string; url: string | null }

export interface McpDeps {
  rt: AgentRuntime
  qboxLlms: string
  changelog: (limit: number) => Promise<ChangelogEntry[]>
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const json = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : (data as Record<string, unknown>) })
const toolError = (message: string) => ({ isError: true, content: [{ type: 'text', text: message }] })
const int = (v: unknown, d: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v))) : d)

export async function callSiteTool(name: string, a: Record<string, unknown>, deps: McpDeps) {
  const pages = () => agentPages(deps.rt, deps.qboxLlms)
  switch (name) {
    case 'get_catalog': {
      const c = agentCatalog(deps.rt)
      const s = typeof a.section === 'string' ? a.section : 'all'
      if (s === 'services') return json(c.offerings.filter((o) => o.kind === 'service'))
      if (s === 'quante') return json({ modules: c.offerings.filter((o) => o.id.startsWith('quante-')), pricing: c.quantePricing })
      if (s === 'qbox') return json(c.offerings.find((o) => o.id === 'qbox'))
      if (s === 'pricing') return json({ quante: c.quantePricing, services: c.offerings.filter((o) => o.kind === 'service').map((o) => ({ id: o.id, price: o.price })), qbox: c.offerings.find((o) => o.id === 'qbox')?.price })
      return json(c)
    }
    case 'list_pages':
      return json(pages().map((p) => ({ id: p.id, title: p.title, url: p.url, markdown: p.md })))
    case 'read_page': {
      const p = agentPageFor(typeof a.page === 'string' ? a.page : '', deps.rt, deps.qboxLlms)
      if (!p) return toolError(`No such page. Pages: ${pages().map((x) => x.url).join(', ')}`)
      return { content: [{ type: 'text', text: p.markdown }], structuredContent: { id: p.id, title: p.title, url: p.url, markdown: p.md } }
    }
    case 'search_site': {
      const q = typeof a.query === 'string' ? a.query.slice(0, 200) : ''
      if (!q.trim()) return toolError('query is required')
      return json({ query: q, hits: searchPages(q, pages(), int(a.limit, 5, 20)) })
    }
    case 'get_changelog':
      return json({ entries: await deps.changelog(int(a.limit, 10, 50)) })
    case 'get_contact': {
      const c = agentCatalog(deps.rt)
      return json({ company: c.organization, contact: c.contact, quante: { start: 'https://quantecode.com/start', signup: 'https://quantecode.com/signup' } })
    }
    default:
      return null
  }
}

/** One JSON-RPC message → its answer (null for notifications). */
export async function handleSiteRpc(m: Rpc, deps: McpDeps): Promise<unknown | null> {
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') return fail(m?.id, -32600, 'Invalid request')
  const notification = m.id === undefined || m.id === null
  switch (m.method) {
    case 'initialize': {
      const asked = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : ''
      return ok(m.id, {
        protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER,
        instructions: MCP_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(m.id, {})
    case 'tools/list':
      return ok(m.id, { tools: SITE_MCP_TOOLS })
    case 'tools/call': {
      const name = typeof m.params?.name === 'string' ? m.params.name : ''
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Record<string, unknown>
      const r = await callSiteTool(name, args, deps)
      return r ? ok(m.id, r) : fail(m.id, -32602, `Unknown tool: ${name}`)
    }
    case 'resources/list':
      return ok(m.id, { resources: agentPages(deps.rt, deps.qboxLlms).map((p) => ({ uri: p.md, name: p.id, title: p.title, mimeType: 'text/markdown' })) })
    case 'resources/read': {
      const uri = typeof m.params?.uri === 'string' ? m.params.uri : ''
      const p = agentPageFor(uri, deps.rt, deps.qboxLlms) ?? agentPages(deps.rt, deps.qboxLlms).find((x) => x.md === uri)
      return p ? ok(m.id, { contents: [{ uri, mimeType: 'text/markdown', text: p.markdown }] }) : fail(m.id, -32002, 'Resource not found')
    }
    default:
      if (notification || m.method.startsWith('notifications/')) return null
      return fail(m.id, -32601, `Method not found: ${m.method}`)
  }
}
