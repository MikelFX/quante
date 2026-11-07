// Onboarding (/start, lib/onboarding/model.ts): each answer lands in an existing module with that
// module's own hand-off filled in, untrusted input is cleaned, the dashboard shows the wizard only
// to a new, empty account, and every route the wizard uses stays wired.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = await import('../lib/onboarding/model.ts')
const ROOT = new URL('../', import.meta.url)
const src = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8')
const ID = '0b6f2a52-6a4e-4c1e-9a0b-2f8e7c3d1a10'
const a = (patch) => ({ ...M.EMPTY, persona: 'business', ...patch })

test('ads → Qads with the product in the composer draft', () => {
  const d = M.destination(a({ goal: 'ads', productName: ' Serum ', productDescription: 'For dry skin' }))
  assert.equal(d.href, '/qads')
  assert.equal(d.drafts.length, 1)
  assert.equal(d.drafts[0].key, 'qads:draft:v1')
  assert.deepEqual(JSON.parse(d.drafts[0].value), { brief: 'For dry skin', productName: 'Serum', productDescription: 'For dry skin' })
})

test('ads → Character mode with its own draft; plan → the store’s plan', () => {
  const c = M.destination(a({ goal: 'ads', adKind: 'character', productName: 'Mug' }))
  assert.equal(c.href, '/qads?mode=character')
  assert.equal(c.drafts[0].key, 'qads:tiktoker:v1')
  assert.equal(JSON.parse(c.drafts[0].value).productName, 'Mug')
  const p = M.destination(a({ goal: 'ads', adKind: 'plan', projectId: ID }))
  assert.equal(p.href, `/qads?mode=plan&project=${ID}`)
  assert.equal(p.drafts.length, 0)
})

test('scan → Qscan with a normalised address; new → the intake chat; edit/review → the Studio', () => {
  assert.equal(M.destination(a({ goal: 'scan', url: 'shop.cz' })).href, `/qscan?url=${encodeURIComponent('https://shop.cz/')}`)
  const n = M.destination(a({ goal: 'new', storeBrief: '  Coffee from Brno  ' }))
  assert.equal(n.href, '/new')
  assert.deepEqual(n.drafts, [{ key: 'quante:new:draft:v1', value: 'Coffee from Brno' }])
  assert.equal(M.destination(a({ goal: 'edit', projectId: ID })).href, `/project/${ID}?tab=edit`)
  assert.equal(M.destination(a({ goal: 'review', projectId: ID })).href, `/project/${ID}?tab=qgent`)
  assert.equal(M.destination(a({ goal: null })).href, '/dashboard')
})

test('store addresses: only plain http(s) hosts', () => {
  assert.equal(M.normalizeUrl('https://www.shop.cz/kategorie'), 'https://www.shop.cz/kategorie')
  for (const bad of ['', 'shop', 'javascript:alert(1)', 'ftp://shop.cz', 'https://user:pw@shop.cz', 'two words.cz']) {
    assert.equal(M.normalizeUrl(bad), null, bad)
  }
})

test('the detail step asks for exactly what its goal needs', () => {
  assert.equal(M.detailReady(a({ goal: 'ads', productName: '' }), false), false)
  assert.equal(M.detailReady(a({ goal: 'ads', productName: 'Mug' }), false), true)
  assert.equal(M.detailReady(a({ goal: 'ads', adKind: 'plan' }), true), false)
  assert.equal(M.detailReady(a({ goal: 'ads', adKind: 'plan', projectId: ID }), true), true)
  assert.equal(M.detailReady(a({ goal: 'scan', url: 'nope' }), false), false)
  assert.equal(M.detailReady(a({ goal: 'new', storeBrief: 'Coffee' }), false), false)
  assert.equal(M.detailReady(a({ goal: 'new', storeBrief: 'Coffee beans' }), false), true)
  assert.equal(M.detailReady(a({ goal: 'review' }), true), false)
})

test('store-only goals and the plan are offered only to accounts with a store; order follows the persona', () => {
  assert.deepEqual(M.goalsFor('business', false).map((g) => g.id), ['ads', 'scan', 'new'])
  assert.deepEqual(M.goalsFor('agency', false).map((g) => g.id), ['new', 'scan', 'ads'])
  assert.deepEqual(M.goalsFor('creator', true).map((g) => g.id), ['ads', 'new', 'scan', 'edit', 'review'])
  assert.deepEqual(M.adKindsFor(false).map((k) => k.id), ['ad', 'character'])
  assert.deepEqual(M.adKindsFor(true).map((k) => k.id), ['ad', 'character', 'plan'])
})

test('untrusted answers are cleaned', () => {
  const p = M.parseAnswers({ persona: 'admin', goal: 'ads', adKind: 'x', projectId: '../etc', productName: 'x'.repeat(500), url: 7 })
  assert.equal(p.persona, null)
  assert.equal(p.goal, 'ads')
  assert.equal(p.adKind, 'ad')
  assert.equal(p.projectId, null)
  assert.equal(p.productName.length, M.LIMITS.name)
  assert.equal(p.url, '')
  assert.deepEqual(M.parseAnswers(null), M.EMPTY)
})

test('saved record and when the dashboard sends an account to /start', () => {
  const saved = M.toSaved({ persona: 'creator', goal: 'ads' }, false, new Date('2026-11-01T00:00:00Z'))
  assert.deepEqual(M.parseSaved(saved), saved)
  assert.equal(M.toSaved({ persona: null, goal: 'ads' }, true).goal, null)
  assert.equal(M.parseSaved({ v: 2 }), null)
  assert.equal(M.shouldOnboard(null, false, false), true)
  assert.equal(M.shouldOnboard(saved, false, false), false)
  assert.equal(M.shouldOnboard(null, true, false), false)
  assert.equal(M.shouldOnboard(null, false, true), false)
  assert.equal(M.startStep({ persona: null, goal: 'ads' }), 0)
  assert.equal(M.startStep({ persona: 'agency', goal: null }), 1)
  assert.equal(M.startStep({ persona: 'agency', goal: 'scan' }), 2)
})

test('the modules read the hand-offs the wizard writes', () => {
  assert.match(src('app/qads/QadsGeneratorClient.tsx'), /'qads:draft:v1'/)
  assert.match(src('app/qads/QadsTiktoker.tsx'), /'qads:tiktoker:v1'/)
  assert.match(src('app/qscan/QscanClient.tsx'), /get\('url'\)/)
  assert.match(src('app/(app)/new/page.tsx'), /NEW_DRAFT_KEY/)
  const studio = src('app/(app)/project/[id]/StudioClient.tsx')
  assert.match(studio, /tab === 'edit'/)
  assert.match(studio, /tab !== 'qgent'/)
  assert.match(src('app/(app)/dashboard/page.tsx'), /redirect\('\/start'\)/)
  assert.match(src('lib/domains.ts'), /'\/start\/:path\*'/)
})

test('the wizard and its API never spend credits', () => {
  for (const f of ['app/start/StartClient.tsx', 'app/api/onboarding/route.ts', 'lib/onboarding/server.ts']) {
    assert.doesNotMatch(src(f), /debit|CREDIT_COSTS\.(generate|export|qads)/, f)
  }
})

test('quantecode.com/ is the Quante overview, the wizard is linked from it (owner 2026-11-04)', () => {
  const cfg = src('next.config.ts')
  assert.match(cfg, /hostRedirects\(SITE_PATHS\.filter\(\(p\) => p !== '\/'\), APP_HOST_PATTERN, SITE_ORIGIN\)/)
  assert.match(cfg, /hostRedirects\(APP_PATHS, SITE_HOST_PATTERN, APP_ORIGIN\)/)
  assert.match(cfg, /destination: '\/quante' \}/)
  const proxy = src('proxy.ts')
  assert.doesNotMatch(proxy, /isAppRoot/)
  // the overview links into the wizard
  // the overview (Czech quantecode.com/ and English /en) is QuanteOverview
  assert.match(src('app/(site)/(quante)/quante/page.tsx'), /<QuanteOverview \/>/)
  assert.match(src('app/(site)/_components/quante/QuanteOverview.tsx'), /quanteApp\.start/)
})
