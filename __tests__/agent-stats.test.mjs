// Public agent numbers (owner 2026-11-06: "kolik agentů jsme přivítali, kolik nakoupilo, kolik
// prodalo"): visits are counted anonymously (hash of address + client per day, never the address),
// a plain browser on /llms.txt is not an agent, every agent door records a visit, the numbers are
// listed where agents look (catalog, llms.txt, OpenAPI) and nothing is typed into the page.
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

const V = await import('../lib/agents/visits.ts')
const D = await import('../lib/agents/discovery.ts')
const C = await import('../lib/agents/catalog.ts')
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const OPEN = { qboxOpen: true, x402: { network: 'base' } }

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

test('a visit is a salted hash per day, never the address or the User-Agent', () => {
  const salt = 's1'
  const a = V.visitRow('api', '203.0.113.7', 'python-requests/2.32', salt, new Date('2026-11-06T10:00:00Z'))
  assert.equal(a.day, '2026-11-06')
  assert.equal(a.agent_hash.length, 32)
  assert.match(a.agent_hash, /^[0-9a-f]+$/)
  assert.ok(!a.agent_hash.includes('203'))
  assert.equal(a.agent, 'python-requests/2.32')
  // same agent, same day → same hash; other salt / other address → other hash
  assert.equal(V.agentHash('203.0.113.7', 'python-requests/2.32', salt), a.agent_hash)
  assert.notEqual(V.agentHash('203.0.113.7', 'python-requests/2.32', 'other'), a.agent_hash)
  assert.notEqual(V.agentHash('203.0.113.8', 'python-requests/2.32', salt), a.agent_hash)
  // the User-Agent is reduced to its first product token, cut to 80 chars
  assert.equal(V.agentName('GPTBot/1.1 (+https://openai.com/gptbot)'), 'GPTBot/1.1')
  assert.equal(V.agentName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'), 'ClaudeBot/1.0')
  assert.equal(V.agentName(CHROME), 'browser')
  assert.equal(V.agentName(''), null)
  assert.equal(V.agentName('x'.repeat(200)).length, 80)
})

test('a plain browser typing /llms.txt is not an agent; API, MCP and paid calls always are', () => {
  assert.equal(V.isLikelyAgent(CHROME), false)
  assert.equal(V.isLikelyAgent('curl/8.6.0'), true)
  assert.equal(V.isLikelyAgent(''), true)
  assert.equal(V.isLikelyAgent('Mozilla/5.0 (compatible; GPTBot/1.1)'), true)
  assert.equal(V.countsAsVisit('llms', CHROME), false)
  assert.equal(V.countsAsVisit('markdown', CHROME), false)
  assert.equal(V.countsAsVisit('discovery', CHROME), false)
  assert.equal(V.countsAsVisit('api', CHROME), true)
  assert.equal(V.countsAsVisit('mcp', CHROME), true)
  assert.equal(V.countsAsVisit('paid', CHROME), true)
  assert.equal(V.visitRow('llms', '1.2.3.4', CHROME, 's'), null)
})

test('an instance writes one row per agent and day', () => {
  const m = new V.VisitMemory(3)
  const row = (h, day = '2026-11-06') => ({ day, agent_hash: h, kind: 'api', agent: null })
  assert.equal(m.first(row('a')), true)
  assert.equal(m.first(row('a')), false)
  assert.equal(m.first(row('b')), true)
  assert.equal(m.first(row('a', '2026-11-07')), true) // a new day starts over
  assert.equal(m.first(row('a', '2026-11-07')), false)
  // the memory is bounded: after `max` hashes it forgets and lets the upsert dedupe
  m.first(row('c', '2026-11-07')); m.first(row('d', '2026-11-07'))
  assert.equal(m.first(row('e', '2026-11-07')), true)
})

test('every agent door records a visit, after the response and never blocking it', () => {
  const doors = {
    'app/api/agent/v1/catalog/route.ts': 'api', 'app/api/agent/v1/pages/route.ts': 'api', 'app/api/agent/v1/search/route.ts': 'api',
    'app/api/agent/v1/inquiry/route.ts': 'api', 'app/api/agent/v1/stats/route.ts': 'api', 'app/api/agent/v1/page/route.ts': 'markdown',
    'app/api/agent/v1/openapi.json/route.ts': 'discovery', 'app/api/agent/well-known/[...file]/route.ts': 'discovery',
    'app/api/agent/llms/route.ts': 'llms', 'app/api/agent/llms-full/route.ts': 'llms', 'app/api/mcp/route.ts': 'mcp',
    'lib/agents/paid.ts': 'paid', 'lib/agents/pay-per-call.ts': 'paid',
  }
  for (const [file, kind] of Object.entries(doors)) {
    assert.ok(read(file).includes(`recordAgentVisit(req, '${kind}')`), `${file} records a '${kind}' visit`)
  }
  const rec = read('lib/agents/visits-record.ts')
  assert.ok(rec.includes('after(') && rec.includes("from 'next/server'"), 'written in after()')
  assert.ok(rec.includes("ignoreDuplicates: true"), 'one row per agent and day')
  assert.ok(!rec.includes('await supabaseAdmin') || rec.indexOf('after(') < rec.indexOf('await supabaseAdmin'), 'the handler never waits for the insert')
  const sql = read('supabase/migration-agent-visits.sql')
  assert.ok(!/\bip\b|address|user_agent/i.test(sql.split('create table')[1].split(';')[0]), 'the table has no address column')
  assert.ok(sql.includes('enable row level security') && sql.includes('agent_public_stats'))
})

test('the numbers are honest: every figure from a table or null, sellers wait for the marketplace', () => {
  const st = read('lib/agents/stats.ts')
  assert.ok(st.includes("sellers: null") && st.includes("marketplace: 'planned'"))
  // "agents that sold" comes from the marketplace's own public endpoint (agreed shape); no answer = planned
  assert.ok(st.includes('/api/qbox/v1/services/stats') && st.includes('AbortSignal.timeout('))
  assert.ok(st.includes("from('agent_x402_calls')") && st.includes("from('qbox_agents')") && st.includes("rpc('agent_public_stats')"))
  assert.ok(!/agentsWelcomed:\s*\d/.test(st), 'no typed numbers')
  const ui = read('app/(site)/_components/quante/AgentNumbers.tsx')
  assert.ok(ui.includes("fetch('/api/agent/v1/stats'") && !/>\s*\d{2,}\s*</.test(ui), 'the strip shows only API numbers')
  assert.ok(read('app/(site)/(quante)/quante/page.tsx').includes('<AgentNumbers />'))
})

test('the marketplace numbers are taken over only when it reports sellers', async () => {
  const { marketplaceFrom } = await import('../lib/agents/stats.ts')
  assert.deepEqual(marketplaceFrom({ error: 'not set up' }), {})
  assert.deepEqual(marketplaceFrom({ sellers: 'x' }), {})
  assert.deepEqual(marketplaceFrom({ servicesLive: 3, sellers: 2, buyers: 5, paidCalls: 12, volumeUsd: 0.36, since: '2026-11-06' }), { sellers: 2, servicesLive: 3, tradesBetweenAgents: 12, tradedUsd: 0.36, marketplace: 'live' })
  assert.deepEqual(marketplaceFrom({ sellers: 0 }), { sellers: 0, servicesLive: null, tradesBetweenAgents: null, tradedUsd: null, marketplace: 'live' })
})

test('agents find the numbers in the catalog, llms.txt and OpenAPI', () => {
  const cat = C.agentCatalog(OPEN)
  assert.equal(cat.agentAccess.rest.stats, C.AGENT_LINKS.stats)
  assert.ok(C.AGENT_LINKS.stats.endsWith('/api/agent/v1/stats'))
  assert.ok(D.llmsTxt('app', OPEN).includes(C.AGENT_LINKS.stats))
  const api = D.agentOpenApi(OPEN)
  assert.ok(api.paths['/stats']?.get, 'OpenAPI lists /stats')
})
