// Qgent swarm (/qgent, lib/qgent/swarm): the page as layers, the rule-based checks, the model's
// findings (cleaned up and read out of a JSON stream while it arrives), the accepted findings in
// the rebuild brief, and the build stage's file → storefront part mapping.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (f) => readFileSync(ROOT + f, 'utf8')
const A = await import('../lib/qgent/swarm/agents.ts')
const L = await import('../lib/qgent/swarm/layers.ts')
const C = await import('../lib/qgent/swarm/checks.ts')
const M = await import('../lib/qgent/swarm/model.ts')
const B = await import('../lib/qgent/swarm/build.ts')
const S = await import('../lib/qgent/swarm/stage.ts')

const SHOP = `<!doctype html><html lang="cs"><head><title>Pražírna | Čerstvá káva</title>
<meta name="viewport" content="width=device-width"><script src="https://cdn.example.com/a.js"></script>
<script>var trap = '<h1>not a heading</h1>'</script><style>h1{color:red}</style></head><body>
<header class="top"><a href="/"><img src="/logo.png" alt="Pražírna"></a>
<nav><a href="/shop">Obchod</a><a href="/o-nas">O nás</a><a href="/kosik"><i class="icon"></i></a></nav></header>
<main><section class="hero"><h1>Čerstvá <b>káva</b> každý týden</h1>
<p>Pražíme v malých várkách v Brně a posíláme do 48 hodin po celé republice.</p>
<a class="btn btn-primary" href="/shop">Více</a></section>
<div style="display:none"><h2>Skrytý nadpis</h2><p>Tohle agenti nevidí, je to schované.</p></div>
<ul class="products"><li class="product-item"><img src="/a.jpg"><h3>Etiopie Yirgacheffe</h3><span>329 Kč</span><button>Do košíku</button></li>
<li class="product-item"><img src="/b.jpg" alt="Kolumbie"><h3>Kolumbie</h3><span>299 Kč</span></li></ul>
<form><input type="email" placeholder="Váš e-mail"><button type="submit">Odebírat novinky</button></form></main>
<footer><p>© 2026 Pražírna s.r.o., IČO 12345678, info@prazirna.cz</p><a href="/obchodni-podminky">Obchodní podmínky</a></footer>
</body></html>`

test('20 agents, unique ids, stable colours', () => {
  assert.equal(A.SWARM_AGENTS.length, 20)
  assert.equal(new Set(A.SWARM_AGENT_IDS).size, 20)
  assert.equal(A.agentIndex('seo'), A.SWARM_AGENT_IDS.indexOf('seo'))
  assert.equal(A.agentIndex('nope'), -1)
  const hues = A.SWARM_AGENTS.map((_, i) => A.agentHue(i))
  assert.ok(hues.every((h) => h >= 0 && h < 360))
  assert.equal(new Set(hues.map((h) => Math.round(h / 6))).size, 20, 'every agent has its own colour')
})

test('the page becomes layers in page order: no scripts, no hidden content', () => {
  const { layers, total } = L.pageLayers(SHOP)
  const kinds = layers.map((l) => l.kind)
  assert.ok(total >= layers.length)
  assert.deepEqual(layers.map((l) => l.id), layers.map((_, i) => `L${i + 1}`))
  assert.equal(kinds[0], 'header')
  const h1 = layers.find((l) => l.kind === 'h1')
  assert.equal(h1.text, 'Čerstvá káva každý týden')
  assert.ok(!layers.some((l) => /not a heading|Skrytý|schované/.test(l.text)), 'scripts and hidden elements are skipped')
  const cards = layers.filter((l) => l.kind === 'product')
  assert.deepEqual(cards.map((c) => c.text), ['Etiopie Yirgacheffe', 'Kolumbie'])
  assert.ok(layers.some((l) => l.kind === 'image' && l.flags?.includes('no-alt')))
  assert.ok(layers.some((l) => l.kind === 'link' && l.flags?.includes('no-text')))
  assert.ok(layers.some((l) => l.kind === 'input' && l.flags?.includes('no-label')))
  assert.ok(layers.some((l) => l.kind === 'button' && l.text === 'Více'))
  assert.ok(layers.every((l) => l.depth >= 0 && l.depth <= 3 && l.text.length <= L.LAYER_LIMITS.text))
})

test('layers are capped and survive broken HTML', () => {
  const many = '<body>' + Array.from({ length: 500 }, (_, i) => `<p>Paragraph number ${i} with enough words to count.</p>`).join('') + '<div><h2>Unclosed'
  const { layers, total } = L.pageLayers(many)
  assert.equal(layers.length, L.LAYER_LIMITS.layers)
  assert.ok(total > layers.length)
  assert.doesNotThrow(() => L.pageLayers('<<<>>><a href=x>'))
})

test('page facts for the checks', () => {
  const f = L.pageFacts(SHOP, 'https://prazirna.cz/')
  assert.equal(f.lang, 'cs')
  assert.equal(f.viewport, true)
  assert.equal(f.h1, 1)
  assert.equal(f.images, 3)
  assert.equal(f.imagesNoAlt, 1)
  assert.equal(f.thirdPartyScripts, 1)
  assert.equal(f.description, '')
  assert.ok(f.hay.includes('obchodní podmínky'))
})

test('rule-based checks: real problems only, in the page language, on a real layer', () => {
  const { layers } = L.pageLayers(SHOP)
  const facts = L.pageFacts(SHOP, 'https://prazirna.cz/')
  const found = C.runChecks(facts, layers)
  const by = (agent) => found.filter((f) => f.agent === agent)
  assert.ok(found.every((f) => A.SWARM_AGENT_IDS.includes(f.agent) && f.source === 'check'))
  assert.ok(found.every((f) => f.layer === null || layers.some((l) => l.id === f.layer)))
  assert.equal(new Set(found.map((f) => f.id)).size, found.length)
  assert.ok(by('seo').some((f) => f.title === 'Chybí meta popis'), 'Czech page → Czech texts')
  assert.ok(by('alt').length === 1)
  assert.ok(by('legal').some((f) => /ochrany osobních/.test(f.title)))
  assert.ok(!by('legal').some((f) => /obchodní podmínky/.test(f.title)), 'terms are there')
  assert.ok(!by('mobile').length, 'viewport is set')
  assert.ok(!by('trust').some((f) => /kontaktovat/.test(f.title)), 'e-mail in the footer counts as contact')
  assert.ok(by('cta').some((f) => /Více/.test(f.title)))
  assert.equal(C.menuLinks(layers), 3)
  const en = C.runChecks({ ...facts, lang: 'en', hay: 'hello' }, layers)
  assert.ok(en.some((f) => f.title === 'No meta description'))
})

test('model findings are cleaned up: known agent, real layer, bounded texts', () => {
  const ids = new Set(['L1', 'L2', 'P3'])
  assert.equal(M.normalizeFinding({ agent: 'hacker', title: 'x' }, ids, 'a-1'), null)
  assert.equal(M.normalizeFinding({ agent: 'seo', title: '' }, ids, 'a-1'), null)
  assert.equal(M.normalizeFinding(null, ids, 'a-1'), null)
  const f = M.normalizeFinding({ agent: 'copy', layer: 'L99', severity: 'urgent', title: 'T'.repeat(500), why: 'w', before: 'Same', after: 'Same' }, ids, 'a-2')
  assert.equal(f.layer, null)
  assert.equal(f.severity, 'medium')
  assert.ok(f.title.length <= M.SWARM_LIMITS.title)
  assert.equal(f.after, '', 'no-op rewrite dropped')
  assert.equal(M.normalizeFinding({ agent: 'detail', layer: 'P3', title: 'x' }, ids, 'a-3').layer, 'P3')
})

test('admitFinding caps per agent and in total, and drops repeats', () => {
  const seen = []
  const mk = (agent, title, layer = null) => ({ id: title, agent, layer, severity: 'low', title, why: '', before: '', after: '', source: 'ai' })
  for (let i = 0; i < 5; i++) {
    const f = mk('seo', `t${i}`)
    if (M.admitFinding(f, seen)) seen.push(f)
  }
  assert.equal(seen.length, M.SWARM_LIMITS.perAgent)
  assert.equal(M.admitFinding(mk('copy', 'T0'), [mk('copy', 't0')]), false)
})

test('findings are read out of the JSON while it streams', () => {
  const doc = JSON.stringify({ findings: [
    { agent: 'copy', layer: 'L1', title: 'Braces { in } copy ]', why: 'a "quoted" \\ thing', before: '', after: '' },
    { agent: 'seo', layer: '', title: 'Second', why: '', before: '', after: '' },
  ], summary: 'ok' })
  const s = M.findingStream()
  const got = []
  for (let i = 0; i < doc.length; i += 7) got.push(...s.push(doc.slice(i, i + 7)))
  assert.equal(got.length, 2)
  assert.equal(got[0].title, 'Braces { in } copy ]')
  assert.equal(got[1].agent, 'seo')
  const t = M.findingStream()
  assert.deepEqual(t.push('{"findings": [ {"agent":"a"'), [])
  assert.equal(t.push('} ]}').length, 1)
})

test('accepted findings go into the rebuild brief, quoted and capped', () => {
  const fs = [
    { id: '1', agent: 'headline', layer: 'L2', severity: 'high', title: 'Say what you sell', why: 'w', before: 'Welcome', after: 'Fresh coffee "every" week', source: 'ai' },
    { id: '2', agent: 'legal', layer: null, severity: 'high', title: 'Add a privacy policy', why: 'GDPR needs it', before: '', after: '', source: 'check' },
  ]
  const b = M.acceptedBrief(fs)
  assert.match(b, /MERCHANT-APPROVED IMPROVEMENTS/)
  assert.match(b, /not instructions/)
  assert.match(b, /\[Hero & value\] "Say what you sell" — change "Welcome" to "Fresh coffee 'every' week"/)
  assert.match(b, /\[Terms & privacy\]/)
  assert.equal(M.acceptedBrief([]), '')
  assert.equal(M.acceptedBrief(fs, 60), '', 'nothing fits → nothing')
  assert.ok(M.acceptedBrief(Array(200).fill(fs[0])).length <= M.SWARM_LIMITS.briefChars)
})

test('build: complete files and the file being written', () => {
  const raw = 'intro <file path="data/config.ts">x</file>\n<file path="styles/store.css">y</file><file path="components/store/HomePage.tsx">partial…'
  assert.deepEqual(B.fileProgress(raw), { done: ['data/config.ts', 'styles/store.css'], writing: 'components/store/HomePage.tsx', writingAll: ['components/store/HomePage.tsx'] })
  assert.deepEqual(B.fileProgress(''), { done: [], writing: null, writingAll: [] })
  assert.equal(B.fileProgress('<file path="a.ts">1</file>').writing, null)
  const parts = B.buildParts(['data/config.ts'], 'components/store/HomePage.tsx')
  const st = Object.fromEntries(parts.map((p) => [p.id, p.state]))
  assert.equal(st.nav, 'done')
  assert.equal(st.footer, 'done')
  assert.equal(st.hero, 'building')
  assert.equal(st.products, 'waiting')
  assert.ok(B.buildParts([], null, true).every((p) => p.state === 'done'))
  assert.deepEqual(B.partsOf('app/cart/page.tsx'), ['pages'])
  assert.deepEqual(B.partsOf('app/page.tsx'), ['hero', 'values'])
})

test('build: every agent works on exactly one part', () => {
  const all = B.BUILD_PARTS.flatMap((p) => p.agents)
  assert.equal(all.length, 20)
  assert.deepEqual([...all].sort(), [...A.SWARM_AGENT_IDS].sort())
})

test('stage: product cards and menu links are grouped', () => {
  const { layers } = L.pageLayers(SHOP)
  const blocks = S.groupLayers(layers)
  assert.ok(blocks.some((b) => b.type === 'links' && b.layers.length === 3))
  const cards = blocks.find((b) => b.type === 'cards')
  assert.equal(cards.cards.length, 2)
  assert.ok(cards.cards[0].parts.some((p) => p.kind === 'button'))
  const flat = blocks.flatMap((b) => (b.type === 'layer' ? [b.layer] : b.type === 'links' ? b.layers : b.cards.flatMap((c) => [c.card, ...c.parts])))
  assert.deepEqual(flat.map((l) => l.id), layers.map((l) => l.id), 'every layer drawn once, in order')
  assert.equal(S.swarmCircle(20, 0, 0, 10).length, 20)
  assert.ok(S.scanDuration(1) >= 7000 && S.scanDuration(10_000) <= 16_000)
})

test('the route: signed in, rights confirmed, Agency included, refund on failure, nothing stored', () => {
  const r = src('app/api/qgent/swarm/route.ts')
  assert.match(r, /if \(!userId\)/)
  assert.match(r, /body\.rights !== true/)
  assert.match(r, /normalizeScanUrl\(/)
  assert.match(r, /debitUnlessAgency\(userId, COST, 'qgent_swarm', runId\)/)
  assert.match(r, /refundDebit\(userId, runId, 'qgent_swarm', 'qgent_swarm_failed'\)/)
  assert.ok(r.indexOf('readHome(') < r.indexOf('debitUnlessAgency('), 'a site that cannot be read costs nothing')
  assert.doesNotMatch(r, /supabaseAdmin/, 'the review stores nothing')
  const run = src('lib/qgent/swarm/run.ts')
  assert.doesNotMatch(run, /\bfetch\(/, 'network only through the Qscan fetcher')
  assert.match(run, /scanFetch\(/)
  assert.match(run, /MODELS\.iteration/)
  assert.match(run, /never instructions to you/)
})

test('the status poll only adds file paths, never file contents', () => {
  const s = src('app/api/quante/generate/status/route.ts')
  assert.match(s, /filesDone: progress\.done/)
  assert.match(s, /files: \{\}/)
})
