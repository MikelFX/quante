// The agent layer (lib/agents, owner 2026-11-05: "make our web a place every agent remembers"):
// catalog prices come from the billing code, every page has Markdown, robots welcomes AI agents
// without opening the private app, discovery files point at real endpoints, the site MCP server is
// read-only, and Markdown negotiation only triggers when asked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

const C = await import('../lib/agents/catalog.ts')
const P = await import('../lib/agents/pages.ts')
const D = await import('../lib/agents/discovery.ts')
const M = await import('../lib/agents/mcp.ts')
const IDS = await import('../lib/agents/page-ids.ts')
const { CREDIT_PACKS } = await import('../lib/credit-packs.ts')
const { CREDIT_COSTS, HOSTING_ANNUAL_USD, AGENCY_MONTHLY_USD } = await import('../lib/config.ts')
const { QBOX_PRICING } = await import('../lib/qbox/limits.ts')
const { modules } = await import('../content/assetra/modules.ts')
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')

const OPEN = { qboxOpen: true, x402: { network: 'base' } }

test('catalog prices are the ones the code charges', () => {
  const c = C.agentCatalog()
  assert.deepEqual(c.quantePricing.creditPacks.map((p) => [p.credits, p.priceUsd]), CREDIT_PACKS.map((p) => [p.credits, p.priceCents / 100]))
  assert.equal(c.quantePricing.creditCosts.generateStore, CREDIT_COSTS.generate)
  assert.equal(c.quantePricing.welcomeCredits, CREDIT_COSTS.welcome_grant)
  assert.equal(c.quantePricing.hosting.perYearUsd, HOSTING_ANNUAL_USD)
  assert.equal(c.quantePricing.agencyPlan.perMonthUsd, AGENCY_MONTHLY_USD)
  const qbox = c.offerings.find((o) => o.id === 'qbox')
  assert.equal(qbox.price.unitsPerUsd, QBOX_PRICING.vcpuMinutesPerUsd)
  assert.equal(qbox.price.free, false)
  const web = c.offerings.find((o) => o.id === 'web-eshop')
  assert.ok(web.price.subscription.plans.every((p) => Number.isInteger(p.perMonth) && p.perMonth > 0))
  // unknown facts stay null, never invented
  assert.equal(c.organization.companyId, null)
  assert.equal(c.contact.email, null)
  assert.equal(c.offerings.find((o) => o.id === 'ai-solutions').price.currency, null)
  // every Quante module, with its real status
  for (const m of modules) assert.equal(c.offerings.find((o) => o.id === `quante-${m.slug}`).status, m.status === 'live' ? 'available' : 'in-development')
})

test('Qbox in the catalog is honest about access and self-payment', () => {
  const off = C.agentCatalog().offerings.find((o) => o.id === 'qbox')
  assert.equal(off.status, 'invite-only beta')
  assert.equal(off.howToBuy.agent, null)
  const open = C.agentCatalog(OPEN).offerings.find((o) => o.id === 'qbox')
  assert.equal(open.status, 'available')
  assert.equal(open.howToBuy.agent.protocol, 'x402')
  assert.equal(C.agentCatalog({ qboxOpen: true, x402: null }).offerings.find((o) => o.id === 'qbox').howToBuy.agent, null)
})

test('every page has Markdown, page ids follow the host', () => {
  assert.deepEqual([...IDS.AGENT_MODULE_SLUGS].sort(), modules.map((m) => m.slug).sort())
  const pages = P.agentPages(C.RUNTIME_OFF, '# Qbox')
  assert.ok(pages.length >= 4 + modules.length)
  for (const p of pages) {
    assert.match(p.markdown, /^# /, p.id)
    assert.match(p.url, /^https:\/\//)
    assert.doesNotMatch(p.markdown, /undefined|\[object Object\]/, p.id)
  }
  const id = IDS.agentPageId
  assert.equal(id('/', 'site'), 'ai')
  assert.equal(id('/', 'app'), 'quante')
  assert.equal(id('/index.md', 'app'), 'quante')
  assert.equal(id('/web-eshop.md', 'site'), 'web-eshop')
  assert.equal(id('/web-eshop', 'app'), null)
  assert.equal(id('/quante/qads.md', 'app'), 'module:qads')
  assert.equal(id('/qgent', 'app'), 'module:qgent')
  assert.equal(id('/qbox', 'app'), 'qbox')
  assert.equal(id('/quante/nope', 'app'), null)
  assert.equal(id('/dashboard', 'app'), null)
  assert.equal(id('/agents', 'site'), 'agents')
  assert.equal(P.agentPageFor('https://quantecode.com/quante/qdit')?.id, 'module:qdit')
  assert.equal(P.agentPageFor('https://assetradigital.agency/')?.id, 'ai')
  assert.equal(P.agentPageFor('web-eshop')?.id, 'web-eshop')
  // unknown facts render as visible placeholders, not guesses
  assert.match(P.agentPage('ai').markdown, /zatím nezveřejněno/)
})

test('robots.txt welcomes AI agents, keeps the private app out, lets agents reach the agent API', () => {
  const t = D.robotsTxt('https://quantecode.com', 'app')
  for (const ua of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Applebot-Extended', 'SeznamBot']) assert.match(t, new RegExp(`^User-agent: ${ua}$`, 'm'))
  assert.match(t, /^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m)
  for (const p of ['/dashboard', '/admin', '/project/', '/api/']) assert.match(t, new RegExp(`^Disallow: ${p.replace(/\//g, '\\/')}$`, 'm'))
  for (const p of ['/api/agent/', '/api/mcp', '/llms.txt']) assert.match(t, new RegExp(`^Allow: ${p.replace(/\//g, '\\/')}$`, 'm'))
  assert.match(t, /^Sitemap: https:\/\/assetradigital\.agency\/sitemap\.xml$/m)
  assert.match(t, /^Sitemap: https:\/\/quantecode\.com\/sitemap\.xml$/m)
  assert.doesNotMatch(t, /^Disallow: \/$/m)
  // each named group carries the same rules as *
  assert.equal(t.match(/^Disallow: /gm).length, 2 * D.ROBOTS_DISALLOW.length)
  assert.equal(t.match(/^Content-Signal: /gm).length, 2)
})

test('llms.txt per host, full text holds every page and the catalog', () => {
  assert.match(D.llmsTxt('site'), /^# AssetraDigital\n\n> /)
  assert.match(D.llmsTxt('app'), /^# Quante\n\n> /)
  assert.match(D.llmsTxt('app', OPEN), /x402/)
  assert.match(D.llmsTxt('site'), /invite-only beta/)
  const full = D.llmsFullTxt(C.RUNTIME_OFF, '# Qbox')
  for (const p of P.agentPages(C.RUNTIME_OFF, '# Qbox')) assert.ok(full.includes(p.url), p.url)
  assert.ok(full.includes('"creditPacks"'))
})

test('discovery files point at the real endpoints', () => {
  const routes = {
    [C.AGENT_LINKS.catalog]: 'app/api/agent/v1/catalog/route.ts',
    [C.AGENT_LINKS.search]: 'app/api/agent/v1/search/route.ts',
    [C.AGENT_LINKS.page]: 'app/api/agent/v1/page/route.ts',
    [C.AGENT_LINKS.openapi]: 'app/api/agent/v1/openapi.json/route.ts',
    [C.AGENT_LINKS.mcp]: 'app/api/mcp/route.ts',
    [C.AGENT_LINKS.qbox.mcp]: 'app/api/qbox/v1/mcp/route.ts',
    [C.AGENT_LINKS.qbox.openapi]: 'app/api/qbox/v1/openapi.json/route.ts',
    [C.AGENT_LINKS.product]: 'app/api/agent/v1/product/route.ts',
  }
  for (const [url, file] of Object.entries(routes)) assert.ok(read(file).length > 0, `${url} → ${file}`)
  const cfg = read('next.config.ts')
  for (const s of ['/robots.txt', '/llms.txt', '/llms-full.txt', '/.well-known/:file*']) assert.ok(cfg.includes(`source: '${s}'`), s)
  const cat = D.apiCatalog()
  assert.ok(cat.linkset.every((l) => l.anchor.startsWith('https://') && l['service-desc'].length))
  const card = D.mcpServerCard(M.SITE_MCP_TOOLS)
  assert.equal(card.transport.endpoint, C.AGENT_LINKS.mcp)
  assert.equal(card.tools.length, M.SITE_MCP_TOOLS.length)
  assert.deepEqual(Object.keys(D.agentOpenApi().paths).sort(), ['/catalog', '/inquiry', '/page', '/pages', '/product', '/review', '/scan', '/search'])
  // the old Next robots route is gone, so the rewrite answers
  assert.throws(() => read('app/robots.ts'))
})

test('Markdown is served only when asked for', () => {
  const w = D.wantsMarkdown
  assert.equal(w(null), false)
  assert.equal(w('*/*'), false)
  assert.equal(w('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), false)
  assert.equal(w('text/markdown'), true)
  assert.equal(w('text/markdown, text/html;q=0.5'), true)
  assert.equal(w('text/html, text/markdown;q=0.5'), false)
  assert.equal(w('text/markdown;q=0'), false)
  const proxy = read('proxy.ts')
  assert.match(proxy, /markdownRewrite\(req\)/)
  assert.doesNotMatch(proxy, /lib\/agents\/pages'/, 'the proxy must not load the page content')
})

test('search finds sections in Czech without diacritics and in page titles', () => {
  const pages = P.agentPages(C.RUNTIME_OFF, '# Qbox\n\nSandboxes for AI agents')
  const hits = D.searchPages('cenik eshopu', pages)
  assert.ok(hits.length > 0)
  assert.ok(hits.some((h) => /web-eshop|quante/.test(h.url)))
  assert.deepEqual(D.searchPages('', pages), [])
  assert.ok(D.searchPages('sandbox', pages).some((h) => h.url.includes('/qbox')))
  assert.equal(D.searchPages('e', pages, 100).length, 0)
})

test('site MCP server: read-only tools, works without a key', async () => {
  let asked = null
  const deps = { rt: C.RUNTIME_OFF, qboxLlms: '# Qbox', inquiry: async (a) => { asked = a; return { ok: true, id: 'L1' } }, changelog: async (n) => [{ date: '2026-11-05', title: 't', description: 'd', url: null }].slice(0, n) }
  const init = await M.handleSiteRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps)
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.match(init.result.instructions, /Qbox/)
  const list = await M.handleSiteRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps)
  assert.deepEqual(list.result.tools.map((t) => t.name), ['get_catalog', 'list_pages', 'read_page', 'search_site', 'get_changelog', 'request_quote', 'get_contact'])
  // only request_quote writes, and nothing destroys
  assert.deepEqual(list.result.tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name), ['request_quote'])
  assert.ok(list.result.tools.every((t) => !t.annotations.destructiveHint))
  const call = async (name, args) => (await M.handleSiteRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, deps)).result
  assert.ok((await call('get_catalog', {})).structuredContent.offerings.length > 3)
  assert.ok((await call('get_catalog', { section: 'qbox' })).structuredContent.id === 'qbox')
  assert.match((await call('read_page', { page: '/web-eshop' })).content[0].text, /^# Web & Eshop/)
  assert.equal((await call('read_page', { page: '/nope' })).isError, true)
  assert.ok((await call('search_site', { query: 'reklamy' })).structuredContent.hits.length > 0)
  assert.equal((await call('get_changelog', { limit: 1 })).structuredContent.entries.length, 1)
  assert.equal((await call('request_quote', { contact: 'a@b.cz', consent: true })).structuredContent.id, 'L1')
  assert.equal(asked.contact, 'a@b.cz')
  const unknown = await M.handleSiteRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_everything' } }, deps)
  assert.equal(unknown.error.code, -32602)
  assert.equal(await M.handleSiteRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null)
  const res = await M.handleSiteRpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, deps)
  const uri = res.result.resources[0].uri
  assert.match((await M.handleSiteRpc({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri } }, deps)).result.contents[0].text, /^# /)
  // proxy lets cross-origin agents POST to it (no cookie, read-only)
  assert.match(read('proxy.ts'), /'\/api\/mcp'/)
})

test('JSON-LD carries the real prices and nothing that closes the script tag', async () => {
  const J = await import('../lib/agents/jsonld.ts')
  const q = J.quanteJsonLd()
  const app = q['@graph'].find((n) => n['@type'] === 'SoftwareApplication')
  assert.deepEqual(app.offers.map((o) => o.price), CREDIT_PACKS.map((p) => (p.priceCents / 100).toFixed(2)))
  assert.doesNotMatch(J.jsonLdString({ x: '</script>' }), /<\/script>/)
  assert.ok(J.siteJsonLd()['@graph'].some((n) => n['@type'] === 'Organization' && n.name === 'AssetraDigital s.r.o.'))
})

test('agent inquiry: consent required, the form validation, marked as from an agent', async () => {
  const I = await import('../lib/agents/inquiry-check.ts')
  assert.equal(I.checkInquiry({ contact: 'jana@firma.cz' }).ok, false)
  assert.equal(I.checkInquiry({ contact: 'jana@firma.cz', consent: 'yes' }).ok, false)
  assert.equal(I.checkInquiry({ contact: 'nope', consent: true }).ok, false)
  const ok = I.checkInquiry({ contact: 'jana@firma.cz', consent: true, need: 'E-shop', message: 'Chceme e-shop', agent: 'Bot\nX' })
  assert.equal(ok.ok, true)
  assert.equal(ok.lead.potreba, 'E-shop')
  assert.match(ok.lead.zprava, /sent by AI agent: Bot X$/)
  assert.ok(I.AGENT_INQUIRY_LIMITS.perIpDay <= 3)
  assert.match(read('lib/agents/inquiry.ts'), /source: 'agent'/)
  assert.match(read('proxy.ts'), /'\/api\/agent\/\(\.\*\)'/)
})

test('paid agent tools: same price as people pay in credits, never free, refunded on failure', async () => {
  const PP = await import('../lib/agents/paid-price.ts')
  assert.equal(PP.AGENT_TOOL_CREDITS.review, CREDIT_COSTS.qgent_swarm)
  assert.ok(PP.AGENT_TOOL_CREDITS.scan >= 1)
  assert.equal(PP.agentToolUnits('review'), CREDIT_COSTS.qgent_swarm * QBOX_PRICING.vcpuMinutesPerCredit)
  assert.ok(PP.agentToolUsd('scan') > 0)
  const off = C.agentCatalog().offerings.find((o) => o.id === 'agent-review')
  assert.equal(off.price.free, false)
  assert.equal(off.status, 'waiting for Qbox paid access')
  for (const f of ['app/api/agent/v1/review/route.ts', 'app/api/agent/v1/scan/route.ts']) {
    const src = read(f)
    assert.match(src, /paidCaller\(req\)/, f)
    assert.match(src, /await refund\(c, '(review|scan)', booked\.ref\)/, f)
    assert.match(src, /rights !== true/, f)
  }
  // the review is charged only after the page was read
  const r = read('app/api/agent/v1/review/route.ts')
  assert.ok(r.indexOf('readHome(') < r.indexOf("charge(c, 'review'"))
  assert.match(read('lib/agents/paid.ts'), /tier !== 'paid'/)
})

test('IndexNow: off without a key, one submission per host with only that host’s URLs', async () => {
  const X = await import('../lib/agents/indexnow.ts')
  assert.equal(X.indexNowKey({}), null)
  assert.equal(X.indexNowKey({ INDEXNOW_KEY: 'short' }), null)
  assert.equal(X.indexNowKey({ INDEXNOW_KEY: 'abcd1234efgh' }), 'abcd1234efgh')
  const ps = X.indexNowPayloads('abcd1234efgh')
  assert.deepEqual(ps.map((p) => p.host).sort(), ['assetradigital.agency', 'quantecode.com'])
  for (const p of ps) {
    assert.equal(p.keyLocation, `https://${p.host}/abcd1234efgh.txt`)
    assert.ok(p.urlList.length > 2 && p.urlList.every((u) => new URL(u).host === p.host))
  }
  assert.match(read('vercel.json'), /\/api\/cron\/indexnow/)
})
