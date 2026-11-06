// The site MCP server (Model Context Protocol, Streamable HTTP, stateless JSON): everything on
// assetradigital.agency + quantecode.com for agents, without a key. Every tool reads, except
// request_quote (an inquiry for the agent's person, consent required, tight limits) and the paid
// reads (PAID_MCP_TOOLS: lookup_product, profile_store, check_company, verify_counterparty, check_store — cents
// per call over x402's MCP transport, lib/agents/pay-per-call.ts). Tools never change, order or run
// anything — running code is Qbox's (its own MCP server, paid). JSON-RPC
// handling is pure here; the route injects the changelog loader, the inquiry and the paid tools.
// Tested in __tests__/agents.test.mjs.

import { AGENT_LINKS, agentCatalog, type AgentRuntime } from './catalog'
import { agentPageFor, agentPages } from './pages'
import { searchPages } from './discovery'
import { INQUIRY_NEEDS, type InquiryResult } from './inquiry-check'
import { agentToolUsd } from './paid-price'

export const MCP_SERVER = { name: 'assetradigital', title: 'AssetraDigital + Quante — site knowledge', version: '1.0.0' }
export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const MCP_INSTRUCTIONS =
  'AssetraDigital (Czech company: AI solutions, custom software, websites and e-shops) and its products Quante (AI e-shop builder, quantecode.com) '
  + 'and Qbox (sandboxes for AI agents). Use get_catalog for products and exact prices, search_site or read_page for details, get_contact to reach people, request_quote when your person wants an offer (with their consent). '
  + `Paid reads, x402 (USDC) in _meta["x402/payment"], no account, not charged when they fail: lookup_product (a product page → JSON, $${usd('product')}), `
  + `profile_store (a store → contacts, company ids, payments, shipping, policies, $${usd('store')}), check_company (Czech IČO / EU VAT in the official registers, $${usd('company')}), `
  + `verify_counterparty (can my person safely pay / invoice this Czech company? ARES + VIES + the VAT-payer register with published accounts, $${usd('counterparty')}), check_store (rule-based store check, $${usd('check')}), find_products (search every agent-ready store in our registry, $${usd('shops')}; list_agent_shops is free). `
  + 'Facts that are null are not published yet: say so, never guess. Pages are Czech. To RUN code, use the Qbox MCP server at '
  + `${AGENT_LINKS.qbox.mcp} (paid, API key).`

function usd(tool: Parameters<typeof agentToolUsd>[0]) {
  return agentToolUsd(tool).toFixed(2)
}

const PAY_HOW = 'Call without payment to get the x402 PaymentRequired (isError), then retry with _meta["x402/payment"].'
const PAID_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const

/** The paid MCP tools → the agent tool they bill as (lib/agents/paid-price.ts). */
export const PAID_MCP_TOOLS = { lookup_product: 'product', profile_store: 'store', check_company: 'company', verify_counterparty: 'counterparty', check_store: 'check', find_products: 'shops' } as const
export type PaidMcpTool = keyof typeof PAID_MCP_TOOLS

/** profile_store's and check_store's arguments (also their Bazaar discovery schema). */
export const STORE_URL_INPUT = {
  type: 'object',
  properties: { url: { type: 'string', description: 'Public store address (home page)' } },
  required: ['url'],
  additionalProperties: false,
} as const

/** check_company's arguments. */
export const CHECK_COMPANY_INPUT = {
  type: 'object',
  properties: {
    ico: { type: 'string', description: 'Czech company number (IČO, 8 digits)' },
    vat: { type: 'string', description: 'EU VAT number with country prefix, e.g. CZ27082440, DE123456789' },
  },
  additionalProperties: false,
} as const

/** verify_counterparty's arguments. */
export const VERIFY_COUNTERPARTY_INPUT = {
  type: 'object',
  properties: {
    ico: { type: 'string', description: 'Czech company number (IČO, 8 digits)' },
    vat: { type: 'string', description: 'EU VAT number with country prefix, e.g. CZ27082440' },
    account: { type: 'string', description: 'The bank account you are about to pay: "19-2000145399/0800", "2000145399/0800" or an IBAN' },
  },
  additionalProperties: false,
} as const

/** find_products' arguments (also its Bazaar discovery schema, lib/agent-shops/tool.ts). */
export const FIND_PRODUCTS_INPUT = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'What to buy, a few words (any language, diacritics ignored)' },
    country: { type: 'string', description: 'Store country, ISO 3166-1 alpha-2 (e.g. CZ)' },
    currency: { type: 'string', description: 'ISO 4217 (e.g. CZK, EUR)' },
    maxPrice: { type: 'number', description: 'Highest unit price in that currency' },
    inStock: { type: 'boolean', description: 'Only products in stock' },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  },
  required: ['query'],
  additionalProperties: false,
} as const

/** list_agent_shops' arguments. */
export const LIST_SHOPS_INPUT = {
  type: 'object',
  properties: {
    country: { type: 'string', description: 'ISO 3166-1 alpha-2' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    offset: { type: 'integer', minimum: 0, default: 0 },
  },
  additionalProperties: false,
} as const

/** lookup_product's arguments (also its Bazaar discovery schema, lib/agents/product-tool.ts). */
export const LOOKUP_PRODUCT_INPUT = {
  type: 'object',
  properties: { url: { type: 'string', description: 'Public product page URL' } },
  required: ['url'],
  additionalProperties: false,
} as const

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
    name: 'request_quote',
    description: 'Send AssetraDigital an inquiry for your person (AI solution, custom software, website, e-shop, management). Only when the person asked for it: consent must be true. '
      + 'Needs a contact (e-mail or phone) where the person wants to be reached; AssetraDigital replies there. Limited to a few per day.',
    inputSchema: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: "The person's e-mail or phone." },
        name: { type: 'string', description: 'Name and company.' },
        need: { type: 'string', enum: [...INQUIRY_NEEDS] },
        message: { type: 'string', description: 'What they need, in a few sentences (Czech or English).' },
        consent: { type: 'boolean', description: 'true = the person asked to be contacted.' },
        agent: { type: 'string', description: 'Your name / product, for our records.' },
      },
      required: ['contact', 'consent'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'lookup_product',
    description: `PAID ($${usd('product')} per call, x402 USDC, no account): one public product page → normalized JSON: name, price, currency, availability, brand, SKU, GTIN, condition, images, rating, variants, from the page's own structured data. `
      + `${PAY_HOW} Not charged when the page cannot be read or has no product data.`,
    inputSchema: LOOKUP_PRODUCT_INPUT,
    annotations: PAID_READ,
  },
  {
    name: 'profile_store',
    description: `PAID ($${usd('store')} per call, x402 USDC, no account): an online store's home page → who runs it and how it sells: name, platform, language, currency, contact e-mails and phones, address, company ids (IČO, EU VAT), social profiles, payment and shipping methods, links to shipping / returns / terms / privacy / contact pages. Only what the page publishes. `
      + `${PAY_HOW} Not charged when the page cannot be read.`,
    inputSchema: STORE_URL_INPUT,
    annotations: PAID_READ,
  },
  {
    name: 'check_company',
    description: `PAID ($${usd('company')} per call, x402 USDC, no account): verify a company in the official registers — a Czech IČO in ARES (name, address, legal form, VAT id, founded, dissolved, activities) and/or an EU VAT number in VIES (valid or not, registered name and address). `
      + `${PAY_HOW} Not charged when the registers cannot be reached; a "not found" / "invalid" answer is a result.`,
    inputSchema: CHECK_COMPANY_INPUT,
    annotations: PAID_READ,
  },
  {
    name: 'verify_counterparty',
    description: `PAID ($${usd('counterparty')} per call, x402 USDC, no account): can your person safely pay or invoice this Czech company? One verdict (safeToPay true / false / null) with named risks from the official registers — ARES (exists, active, dissolved, in liquidation, record in the insolvency register), VIES (EU VAT number valid), the Czech tax administration's VAT-payer register (marked an unreliable payer since when, the bank accounts it published) — and, when you pass the account you are about to pay, whether it is a published one (paying an unpublished account makes the customer liable for the payer's unpaid VAT). For every invoice and payment to a Czech company. `
      + `${PAY_HOW} Not charged when the registers cannot be reached.`,
    inputSchema: VERIFY_COUNTERPARTY_INPUT,
    annotations: PAID_READ,
  },
  {
    name: 'check_store',
    description: `PAID ($${usd('check')} per call, x402 USDC, no account): a quick rule-based check of an online store's home page (and one product page) by the Qgent checks — headline, buttons, image alt texts, prices, trust signals, contact, policies, SEO basics — as findings with severity and why, in English. No AI involved, answers in seconds. `
      + `${PAY_HOW} Not charged when the page cannot be read.`,
    inputSchema: STORE_URL_INPUT,
    annotations: PAID_READ,
  },
  {
    name: 'list_agent_shops',
    description: 'The registry of agent-ready online stores: every store that describes itself for agents (/.well-known/agent-shop.json) and lets you search, price and order through its own API or MCP server. Free.',
    inputSchema: LIST_SHOPS_INPUT,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'find_products',
    description: `PAID ($${usd('shops')} per call, x402 USDC, no account): search products across every agent-ready store in the registry — price, availability, stock and the store's own agent-shop.json and MCP server to price and order there. `
      + `${PAY_HOW} Not charged when nothing is found.`,
    inputSchema: FIND_PRODUCTS_INPUT,
    annotations: PAID_READ,
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
  /** Stores an agent inquiry (lib/agents/inquiry.ts submitInquiry, bound to the caller's IP). */
  inquiry: (input: Record<string, unknown>) => Promise<InquiryResult>
  /** A paid tool (lib/agents/pay-per-call.ts mcpPaidCall), given the call's `_meta`. */
  paidTool: (name: PaidMcpTool, input: Record<string, unknown>, meta: unknown) => Promise<unknown>
  /** The free directory of agent-ready stores (lib/agent-shops/registry.ts); null when not set up. */
  shops: (p: { country: string | null; limit: number; offset: number }) => Promise<Record<string, unknown> | null>
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const json = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: Array.isArray(data) ? { items: data } : (data as Record<string, unknown>) })
const toolError = (message: string) => ({ isError: true, content: [{ type: 'text', text: message }] })
const int = (v: unknown, d: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.floor(v))) : d)

export async function callSiteTool(name: string, a: Record<string, unknown>, deps: McpDeps, meta?: unknown) {
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
    case 'request_quote': {
      const r = await deps.inquiry(a)
      return r.ok ? json({ ok: true, id: r.id, next: 'AssetraDigital will contact the person. Nothing else is needed.' }) : toolError(r.error)
    }
    case 'lookup_product':
    case 'profile_store':
    case 'check_company':
    case 'verify_counterparty':
    case 'check_store':
    case 'find_products':
      return deps.paidTool(name, a, meta)
    case 'list_agent_shops': {
      const r = await deps.shops({ country: typeof a.country === 'string' ? a.country : null, limit: int(a.limit, 50, 100), offset: typeof a.offset === 'number' && a.offset > 0 ? Math.floor(a.offset) : 0 })
      return r ? json(r) : toolError('The registry of agent-ready stores is not open yet.')
    }
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
      const r = await callSiteTool(name, args, deps, m.params?._meta)
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
