// How agents find us: robots.txt, llms.txt / llms-full.txt, the RFC 9727 API catalog, the MCP server
// card, the OpenAPI of the agent API, Markdown content negotiation and a small keyword search.
// Pure (no I/O, no env): routes pass the host and the runtime switches in. Tested in
// __tests__/agents.test.mjs.

import { APP_ORIGIN, SITE_ORIGIN, hostKind } from '@/lib/domains'
import { AGENT_LINKS, agentCatalog, RUNTIME_OFF, type AgentRuntime } from './catalog'
import { agentPages, type AgentPage } from './pages'
import { INQUIRY_NEEDS } from './inquiry-check'
import { agentToolUsd } from './paid-price'

export { wantsMarkdown } from './negotiate'

type Kind = ReturnType<typeof hostKind>

// ── robots.txt ────────────────────────────────────────────────────────────────

/** App areas behind sign-in or without public value (same list as before 2026-11-05). */
export const ROBOTS_DISALLOW = ['/api/', '/dashboard', '/billing', '/settings', '/admin', '/new', '/project/', '/marketplace', '/preview/', '/invoice/'] as const

/** Public machine endpoints under /api/ that crawlers and agents MUST reach (more specific Allow wins). */
export const ROBOTS_ALLOW_API = ['/api/agent/', '/api/mcp', '/api/qbox/v1/openapi.json', '/api/qbox/v1/mcp'] as const

/**
 * AI crawlers, AI search bots and user-triggered agents we welcome by name (owner 2026-11-05:
 * "every agent must remember us" — training included). A named group overrides `*` for that bot,
 * so each group repeats the same rules.
 */
export const AI_AGENTS = [
  // OpenAI
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  // Anthropic
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  // Google (Gemini training/grounding token + search)
  'Google-Extended', 'Googlebot', 'GoogleOther', 'Google-CloudVertexBot',
  // Microsoft / Bing (also feeds Copilot and ChatGPT search)
  'Bingbot', 'BingPreview',
  // Apple
  'Applebot', 'Applebot-Extended',
  // Perplexity
  'PerplexityBot', 'Perplexity-User',
  // Meta
  'meta-externalagent', 'meta-externalfetcher', 'FacebookBot',
  // Amazon, Mistral, Cohere, DuckDuckGo, You.com, xAI
  'Amazonbot', 'MistralAI-User', 'cohere-ai', 'cohere-training-data-crawler', 'DuckAssistBot', 'YouBot', 'xAI-Bot',
  // Open datasets most models are trained on, research crawlers
  'CCBot', 'AI2Bot', 'Diffbot', 'Omgilibot', 'Timpibot', 'ImagesiftBot',
  // ByteDance, Huawei, Baidu, Yandex, Naver
  'Bytespider', 'PetalBot', 'Baiduspider', 'YandexBot', 'YandexAdditional', 'Yeti',
  // Czech search
  'SeznamBot',
] as const

/** Cloudflare Content Signals (contentsignals.org): yes to search, answers and training. */
export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes'

export function robotsTxt(origin: string, kind: Kind): string {
  const rules = [
    'Allow: /',
    ...ROBOTS_ALLOW_API.map((p) => `Allow: ${p}`),
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Allow: /.well-known/',
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
  ].join('\n')
  const sitemaps = kind === 'shared' ? [`${origin}/sitemap.xml`] : [`${SITE_ORIGIN}/sitemap.xml`, `${APP_ORIGIN}/sitemap.xml`]
  return `# ${kind === 'site' ? 'AssetraDigital' : kind === 'app' ? 'Quante' : 'AssetraDigital + Quante'} — robots.txt
#
# AI agents, assistants and crawlers are welcome here: read, cite, answer with and learn from
# every public page. You don't need to scrape:
#   llms.txt        ${origin}/llms.txt   (full text: ${AGENT_LINKS.llmsFull})
#   JSON catalog    ${AGENT_LINKS.catalog}   (every product and price, from the billing code)
#   MCP server      ${AGENT_LINKS.mcp}   (Streamable HTTP, no key)
#   Ask for a quote POST ${APP_ORIGIN}/api/agent/v1/inquiry   (for your person, with their consent)
#   Markdown        any page with "Accept: text/markdown", or the path + ".md"
#   API catalog     ${AGENT_LINKS.apiCatalog}
#   For agents      ${SITE_ORIGIN}/agents.md
#   Sandboxes       ${AGENT_LINKS.qbox.llms}   (Qbox: compute for agents)
#
# Content-Signal: search = index and link us; ai-input = use us in AI answers (RAG, grounding);
# ai-train = use us to train or fine-tune models.

User-agent: *
Content-Signal: ${CONTENT_SIGNAL}
${rules}

# Named AI agents: the same welcome, spelled out for each.
${AI_AGENTS.map((ua) => `User-agent: ${ua}`).join('\n')}
Content-Signal: ${CONTENT_SIGNAL}
${rules}

${sitemaps.map((s) => `Sitemap: ${s}`).join('\n')}
`
}

// ── llms.txt (llmstxt.org) ────────────────────────────────────────────────────

const pageLine = (p: AgentPage) => `- [${p.title}](${p.md})`

export function llmsTxt(kind: Kind, rt: AgentRuntime = RUNTIME_OFF): string {
  const pages = agentPages(rt)
  const by = (id: string) => pages.find((p) => p.id === id)!
  const modulesList = pages.filter((p) => p.id.startsWith('module:')).map(pageLine).join('\n')
  const company = `## AssetraDigital (${SITE_ORIGIN})

- [AI řešení a software na míru](${by('ai').md}): AI integrace, systémy kolem AI jádra, CRM, asistenti, automatizace. Cena po konzultaci.
- [Web & Eshop na míru](${by('web-eshop').md}): weby a e-shopy bez vstupní investice, měsíční paušál (ceník v CZK).`
  const quante = `## Quante (${APP_ORIGIN})

- [Quante: přehled a ceník](${by('quante').md}): AI e-shop builder. E-shop z textového zadání, úpravy na stránce, reklamy, kontrola 20 agenty. Kredity v USD.
${modulesList}`
  const agents = `## For agents

- [Start here](${by('agents').md}): how to use this site as an agent
- [JSON catalog](${AGENT_LINKS.catalog}): every product, price and status in one object
- [MCP server](${AGENT_LINKS.mcp}): get_catalog, list_pages, read_page, search_site, get_changelog, get_contact, request_quote (no key)
- [OpenAPI](${AGENT_LINKS.openapi}) · [API catalog](${AGENT_LINKS.apiCatalog}) · [Full text](${AGENT_LINKS.llmsFull})
- Paid tools for agents ([OpenAPI](${AGENT_LINKS.openapi})): product page to product JSON $${agentToolUsd('product').toFixed(2)} (GET ${AGENT_LINKS.product}?url=…), store scan to JSON $${agentToolUsd('scan').toFixed(2)}, store review by 20 agents $${agentToolUsd('review').toFixed(2)}; pay per call over x402 with no account (product, scan; charged only when it works) or from a Qbox account
- [Qbox](${AGENT_LINKS.qbox.llms}): sandboxes for AI agents — ${rt.qboxOpen ? (rt.x402 ? 'pay by yourself over x402 (USDC), no sign-up' : 'paid, prepaid balance') : 'invite-only beta'}`
  const head = kind === 'app'
    ? `# Quante\n\n> AI e-commerce builder and tools for e-shops (generate, edit, ads, review by 20 agents), plus Qbox, sandboxes for AI agents. A product of AssetraDigital s.r.o. (Czech Republic). The product pages are Czech, the app and APIs English.`
    : `# AssetraDigital\n\n> Czech company building AI solutions, custom software, websites and e-shops, and the products Quante (AI e-shop builder, quantecode.com) and Qbox (sandboxes for AI agents). Website in Czech.`
  const notes = `## Notes

- Prices come from the code that charges them; null / "[…: zatím nezveřejněno]" means not published yet — say so, never guess.
- Every page also answers \`Accept: text/markdown\`; add ".md" to any path for its Markdown.`
  const order = kind === 'app' ? [quante, agents, company] : [company, quante, agents]
  return [head, ...order, notes].join('\n\n') + '\n'
}

/** Everything in one file: every page's Markdown + the catalog. */
export function llmsFullTxt(rt: AgentRuntime = RUNTIME_OFF, qboxLlms = ''): string {
  const pages = agentPages(rt, qboxLlms)
  return `# AssetraDigital + Quante + Qbox — full text for language models

> Every public page of ${SITE_ORIGIN} and ${APP_ORIGIN} as Markdown, then the machine-readable catalog. Canonical URL above each page.

${pages.map((p) => `<!-- ${p.url} -->\n\n${p.markdown.trim()}`).join('\n\n---\n\n')}

---

# Catalog (JSON, also at ${AGENT_LINKS.catalog})

\`\`\`json
${JSON.stringify(agentCatalog(rt), null, 2)}
\`\`\`
`
}

// ── /.well-known ──────────────────────────────────────────────────────────────

/** RFC 9727 API catalog (application/linkset+json). */
export function apiCatalog() {
  return {
    linkset: [
      {
        anchor: `${APP_ORIGIN}/api/agent/v1`,
        'service-desc': [{ href: AGENT_LINKS.openapi, type: 'application/openapi+json' }],
        'service-doc': [{ href: AGENT_LINKS.llmsFull, type: 'text/plain' }, { href: `${SITE_ORIGIN}/agents.md`, type: 'text/markdown' }],
        'service-meta': [{ href: AGENT_LINKS.catalog, type: 'application/json' }],
      },
      {
        anchor: AGENT_LINKS.mcp,
        'service-desc': [{ href: AGENT_LINKS.mcpCard, type: 'application/json' }],
        'service-doc': [{ href: `${SITE_ORIGIN}/agents.md`, type: 'text/markdown' }],
      },
      {
        anchor: AGENT_LINKS.qbox.api,
        'service-desc': [{ href: AGENT_LINKS.qbox.openapi, type: 'application/openapi+json' }],
        'service-doc': [{ href: AGENT_LINKS.qbox.llms, type: 'text/plain' }, { href: AGENT_LINKS.qbox.page, type: 'text/html' }],
      },
    ],
  }
}

/** MCP server card (draft SEP-1649 shape) for the site MCP server. */
export function mcpServerCard(tools: { name: string; description: string }[]) {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
    version: '1.0',
    protocolVersion: '2025-06-18',
    serverInfo: { name: 'assetradigital', title: 'AssetraDigital + Quante — site knowledge', version: '1.0.0' },
    description: 'MCP server for everything on assetradigital.agency and quantecode.com: products, prices, pages as Markdown, search, changelog, contact, and request_quote (an inquiry for your person). No key.',
    documentationUrl: `${SITE_ORIGIN}/agents.md`,
    transport: { type: 'streamable-http', endpoint: AGENT_LINKS.mcp },
    authentication: { required: false },
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
    related: [{ name: 'qbox', title: 'Qbox — sandboxes for AI agents', endpoint: AGENT_LINKS.qbox.mcp, authentication: { required: true, schemes: ['bearer'] } }],
  }
}

/** /.well-known/mcp.json — both servers of this origin. */
export function mcpIndex() {
  return {
    servers: [
      { name: 'assetradigital', url: AGENT_LINKS.mcp, transport: 'streamable-http', auth: 'none', card: AGENT_LINKS.mcpCard },
      { name: 'qbox', url: AGENT_LINKS.qbox.mcp, transport: 'streamable-http', auth: 'bearer', docs: AGENT_LINKS.qbox.llms },
    ],
  }
}

// ── OpenAPI of the agent API ─────────────────────────────────────────────────

export function agentOpenApi() {
  const text = (desc: string, type = 'text/markdown') => ({ description: desc, content: { [type]: { schema: { type: 'string' } } } })
  return {
    openapi: '3.1.0',
    info: {
      title: 'AssetraDigital + Quante agent API',
      version: '1.0.0',
      description: 'No key, CORS open. The whole offer, every page as Markdown, search, and an inquiry an agent sends for its person. For running code see Qbox.',
    },
    servers: [{ url: `${APP_ORIGIN}/api/agent/v1` }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: `Qbox API key qbx_… — open one by yourself: POST ${AGENT_LINKS.qbox.api}/accounts` } } },
    paths: {
      '/catalog': { get: { operationId: 'getCatalog', summary: 'Every product, price and status', responses: { 200: { description: 'Catalog', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/page': {
        get: {
          operationId: 'readPage', summary: 'A page as Markdown',
          parameters: [{ name: 'url', in: 'query', required: true, schema: { type: 'string' }, description: 'Page URL or path, e.g. https://quantecode.com/quante/qads or /web-eshop' }],
          responses: { 200: text('Markdown'), 404: { description: 'No such page' } },
        },
      },
      '/pages': { get: { operationId: 'listPages', summary: 'Every page with its URLs', responses: { 200: { description: 'Pages', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } } },
      '/inquiry': {
        post: {
          operationId: 'requestQuote', summary: 'Send AssetraDigital an inquiry for your person (consent required, a few per day)',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['contact', 'consent'],
            properties: { contact: { type: 'string' }, name: { type: 'string' }, need: { type: 'string', enum: [...INQUIRY_NEEDS] }, message: { type: 'string' }, consent: { type: 'boolean', const: true }, agent: { type: 'string' } },
          } } } },
          responses: { 200: { description: 'Stored; AssetraDigital will contact the person' }, 400: { description: 'Invalid' }, 429: { description: 'Limit reached' } },
        },
      },
      ...Object.fromEntries((['review', 'scan'] as const).map((tool) => [`/${tool}`, {
        post: {
          operationId: tool === 'review' ? 'reviewStore' : 'scanStore',
          summary: tool === 'review' ? `20 Qgent agents review a store page ($${agentToolUsd(tool).toFixed(2)} per call, refunded when it fails)` : `A store read into structured JSON ($${agentToolUsd(tool).toFixed(2)} per call, refunded when it fails)`,
          security: [{ bearer: [] }],
          parameters: [{ name: 'X-PAYMENT', in: 'header', required: false, schema: { type: 'string' }, description: 'x402 payment (repeat a 402-answered call with it)' }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url', 'rights'], properties: { url: { type: 'string' }, rights: { type: 'boolean', const: true, description: 'The store is your person’s, or they may use its content.' } } } } } },
          responses: { 200: { description: 'Result (JSON)' }, 401: { description: 'API key missing' }, 402: { description: 'Balance too low: x402 offer + other ways to pay' }, 403: { description: 'No paid access' }, 422: { description: 'Site could not be read (not charged)' }, 429: { description: 'Limit' } },
        },
      }])),
      '/product': {
        get: {
          operationId: 'lookupProduct',
          summary: `Product page → normalized product JSON ($${agentToolUsd('product').toFixed(2)} per call; not charged when the page has no product data)`,
          description: 'Name, price, currency, availability, brand, SKU, GTIN, condition, images, rating and variants, read from the page\'s own JSON-LD / microdata / OpenGraph. Pay per call over x402 v1 or v2 with no account (call, get 402, repeat with the payment header; settled only after it worked), or Bearer qbx_…. POST { url } works too.',
          security: [{}, { bearer: [] }],
          parameters: [
            { name: 'url', in: 'query', required: true, schema: { type: 'string' }, description: 'Public product page URL' },
            { name: 'PAYMENT-SIGNATURE', in: 'header', required: false, schema: { type: 'string' }, description: 'x402 v2 payment (repeat the 402-answered call with it; the offer is in the PAYMENT-REQUIRED header)' },
            { name: 'X-PAYMENT', in: 'header', required: false, schema: { type: 'string' }, description: 'x402 v1 payment (the offer is in the 402 body)' },
          ],
          responses: { 200: { description: 'Product(s) as JSON' }, 402: { description: 'Payment required: x402 accepts (exact price)' }, 422: { description: 'Page unreadable or no product data (not charged)' }, 429: { description: 'Limit' }, 503: { description: 'Pay-per-call off: use a Qbox account' } },
        },
      },
      '/search': {
        get: {
          operationId: 'searchSite', summary: 'Keyword search over every page',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }],
          responses: { 200: { description: 'Hits', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
  }
}

// ── search ────────────────────────────────────────────────────────────────────

/** Lower case, no diacritics, words of 2+ letters. */
export function tokens(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 2)
}

export interface SearchHit { title: string; section: string | null; url: string; md: string; excerpt: string; score: number }

/** Keyword search over every page, by section (## heading). Prefix match counts half. */
export function searchPages(query: string, pages: AgentPage[], limit = 5): SearchHit[] {
  const q = [...new Set(tokens(query))]
  if (!q.length) return []
  const hits: SearchHit[] = []
  for (const p of pages) {
    const parts = p.markdown.split(/\n(?=##? )/)
    for (const part of parts) {
      const heading = /^##?#? (.+)/.exec(part)?.[1]?.trim() ?? null
      const words = tokens(part)
      if (!words.length) continue
      let score = 0
      for (const t of q) {
        const exact = words.filter((w) => w === t).length
        const prefix = exact ? 0 : words.filter((w) => w.startsWith(t) || (t.length >= 5 && t.startsWith(w) && w.length >= 4)).length
        if (exact + prefix) score += 1 + Math.log(1 + exact + prefix / 2)
        if (heading && tokens(heading).includes(t)) score += 1
      }
      if (score <= 0) continue
      const body = part.replace(/^#+ .+\n?/, '').replace(/\s+/g, ' ').trim()
      hits.push({ title: p.title, section: heading, url: p.url, md: p.md, excerpt: body.length > 400 ? body.slice(0, 397) + '…' : body, score: Math.round(score * 100) / 100 })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit)))
}
