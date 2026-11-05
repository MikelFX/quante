// Paid agent tools beyond the product lookup (lib/agents/store-profile.ts, lib/agents/company.ts,
// lib/agents/agent-tools.ts): store profile, company check in ARES + VIES, quick store check.
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

const S = await import('../lib/agents/store-profile.ts')
const CO = await import('../lib/agents/company.ts')
const PR = await import('../lib/agents/paid-price.ts')
const CH = await import('../lib/qgent/swarm/checks.ts')
const L = await import('../lib/qgent/swarm/layers.ts')
const R = await import('../lib/agents/run-once.ts')

const STORE = `<!doctype html><html lang="cs"><head><title>Kafe u Lípy – výběrová káva</title>
<meta property="og:site_name" content="Kafe u Lípy"><meta name="description" content="Pražírna v Brně.">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'Organization', name: 'Kafe u Lípy', legalName: 'Kafe u Lípy s.r.o.', telephone: '+420 777 123 456', email: 'ahoj@kafeulipy.cz',
    address: { '@type': 'PostalAddress', streetAddress: 'Lipová 12', postalCode: '602 00', addressLocality: 'Brno', addressCountry: 'CZ' },
    sameAs: ['https://www.instagram.com/kafeulipy', 'https://www.facebook.com/kafeulipy'] },
] })}</script>
<script>var x = "nobody@tracking.example.com"</script></head>
<body><header><nav><a href="/obchod">Obchod</a><a href="/o-nas">O nás</a><a href="/kontakt">Kontakt</a></nav>
<img class="logo" src="/logo.svg" alt="Kafe u Lípy"></header>
<main><h1>Káva pražená každý týden</h1><p>Cena od 289 Kč. Doprava Zásilkovnou a PPL, platba kartou, Apple Pay nebo dobírkou.</p></main>
<footer><a href="mailto:objednavky@kafeulipy.cz?subject=Dotaz">Napište nám</a> <a href="tel:+420 777 123 456">Zavolejte</a>
<a href="/obchodni-podminky">Obchodní podmínky</a> <a href="/reklamace-a-vraceni">Reklamace a vrácení</a>
<a href="/doprava-a-platba">Doprava a platba</a> <a href="/ochrana-osobnich-udaju">Ochrana osobních údajů</a>
<a href="https://tiktok.com/@kafeulipy">TikTok</a>
<p>Kafe u Lípy s.r.o., IČO: 27082440, DIČ: CZ27082440. Neplatné IČ: 12345678.</p></footer></body></html>`

test('store profile: contacts, company ids, policies, payments, shipping, socials', () => {
  const p = S.storeProfile(STORE, 'https://kafeulipy.cz/')
  assert.equal(p.name, 'Kafe u Lípy')
  assert.equal(p.language, 'cs')
  assert.equal(p.currency, 'CZK')
  assert.deepEqual(p.contact.emails.sort(), ['ahoj@kafeulipy.cz', 'objednavky@kafeulipy.cz'])
  assert.deepEqual(p.contact.phones, ['+420777123456'])
  assert.equal(p.contact.address, 'Lipová 12, 602 00, Brno, CZ')
  assert.equal(p.company.legalName, 'Kafe u Lípy s.r.o.')
  assert.deepEqual(p.company.ico, ['27082440']) // 12345678 fails the check digit
  assert.deepEqual(p.company.vatIds, ['CZ27082440'])
  assert.equal(p.policies.terms, 'https://kafeulipy.cz/obchodni-podminky')
  assert.equal(p.policies.returns, 'https://kafeulipy.cz/reklamace-a-vraceni')
  assert.equal(p.policies.shipping, 'https://kafeulipy.cz/doprava-a-platba')
  assert.equal(p.policies.privacy, 'https://kafeulipy.cz/ochrana-osobnich-udaju')
  assert.equal(p.policies.contact, 'https://kafeulipy.cz/kontakt')
  assert.equal(p.policies.about, 'https://kafeulipy.cz/o-nas')
  assert.deepEqual(p.payments.sort(), ['apple_pay', 'card', 'cash_on_delivery'])
  assert.deepEqual(p.shipping.sort(), ['packeta', 'ppl'])
  assert.deepEqual(p.socials.map((s) => s.platform).sort(), ['facebook', 'instagram', 'tiktok'])
  assert.equal(p.logo, 'https://kafeulipy.cz/logo.svg')
  // e-mails inside scripts are not the store's
  assert.ok(!p.contact.emails.includes('nobody@tracking.example.com'))
})

test('store profile: nothing published = nothing guessed', () => {
  const p = S.storeProfile('<html><head><title>X</title></head><body><p>Hello there, a plain page with nothing.</p></body></html>', 'https://x.example/')
  assert.deepEqual(p.contact, { emails: [], phones: [], address: null })
  assert.deepEqual(p.company, { legalName: null, ico: [], vatIds: [] })
  assert.deepEqual(p.payments, [])
  assert.deepEqual(p.policies, {})
  assert.equal(p.currency, null)
})

test('IČO check digit and company query parsing', () => {
  assert.equal(CO.isValidIco('27082440'), true)
  assert.equal(CO.isValidIco('25596641'), true)
  assert.equal(CO.isValidIco('12345678'), false)
  assert.equal(CO.isValidIco('2708244'), false)
  assert.deepEqual(CO.parseCompanyQuery({ ico: '27082440' }), { ico: '27082440', vat: null })
  // a Czech VAT number of a company also looks the IČO up in ARES; GR is VIES's EL
  assert.deepEqual(CO.parseCompanyQuery({ vat: 'cz 270 82 440' }), { ico: '27082440', vat: { country: 'CZ', number: '27082440' } })
  assert.deepEqual(CO.parseCompanyQuery({ vat: 'GR123456789' }), { ico: null, vat: { country: 'EL', number: '123456789' } })
  assert.equal(CO.parseCompanyQuery({ vat: 'DE123456789' }).ico, null)
  for (const bad of [{}, { ico: '12345678' }, { ico: 'abc' }, { vat: 'US123456789' }, { vat: '27082440' }]) {
    assert.throws(() => CO.parseCompanyQuery(bad), CO.CompanyInputError)
  }
})

test('ARES and VIES answers → the company', () => {
  const a = CO.aresCompany({
    ico: '27082440', obchodniJmeno: 'Alza.cz a.s.', dic: 'CZ27082440', pravniForma: '121', datumVzniku: '2003-08-26',
    sidlo: { kodStatu: 'CZ', textovaAdresa: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7' },
    seznamRegistraci: { stavZdrojeDph: 'AKTIVNI' }, czNace2008: ['47911', '620'],
  })
  assert.deepEqual(a, {
    ico: '27082440', name: 'Alza.cz a.s.', vatId: 'CZ27082440', vatRegistered: true, legalForm: 'joint-stock company (a.s.)', legalFormCode: '121',
    address: 'Jankovcova 1522/53, Holešovice, 17000 Praha 7', country: 'CZ', founded: '2003-08-26', dissolved: null, active: true, activities: ['47911', '620'],
  })
  assert.equal(CO.aresCompany({ kod: 'NENALEZENO' }), null)
  assert.equal(CO.aresCompany({ ico: '1', obchodniJmeno: 'X', datumZaniku: '2020-01-01' }).active, false)

  const v = CO.viesCheck({ isValid: true, userError: 'VALID', name: 'Alza.cz a.s.', address: 'Jankovcova 1522/53\nPRAHA 7', requestDate: '2026-11-05T18:09:42.542Z' }, 'CZ', '27082440')
  assert.deepEqual(v, { vatNumber: 'CZ27082440', valid: true, name: 'Alza.cz a.s.', address: 'Jankovcova 1522/53, PRAHA 7', checkedAt: '2026-11-05T18:09:42.542Z', note: null })
  assert.equal(CO.viesCheck({ isValid: false, userError: 'INVALID', name: '---' }, 'DE', '1').valid, false)
  assert.equal(CO.viesCheck({ isValid: false, userError: 'INVALID', name: '---' }, 'DE', '1').name, null)
  // a register that can't be asked is not "invalid"
  const down = CO.viesCheck({ isValid: false, userError: 'MS_UNAVAILABLE' }, 'DE', '1')
  assert.equal(down.valid, null)
  assert.match(down.note, /not answering/)
})

test('quick check: the rule checks can be asked in English for any page', () => {
  const html = '<html lang="cs"><body><main><h1>Káva</h1><img src="/a.jpg"><img src="/b.jpg"><a href="#">Klikněte zde</a></main></body></html>'
  const { layers } = L.pageLayers(html)
  const facts = L.pageFacts(html, 'https://kafe.example/')
  const cs = CH.runChecks(facts, layers)
  const en = CH.runChecks(facts, layers, null, 'en')
  assert.equal(cs.length, en.length)
  assert.ok(en.length > 0)
  assert.ok(en.every((f) => !/[ěščřžůň]/.test(f.title)), 'English titles')
})

test('prices: a cent or two per call, never free, all per call over x402', () => {
  assert.equal(PR.agentToolUsd('store'), 0.01)
  assert.equal(PR.agentToolUsd('company'), 0.01)
  assert.equal(PR.agentToolUsd('check'), 0.02)
  for (const t of ['store', 'company', 'check']) {
    assert.ok(PR.agentToolUnits(t) > 0)
    assert.ok(PR.PAY_PER_CALL_TOOLS.includes(t))
  }
})

test('run once: input checked, no network, no secrets, stopped either way', () => {
  assert.deepEqual(R.parseRunOnce({ language: 'python', code: 'print(1)' }), { language: 'python', template: 'python3.13', cmd: 'python3', args: ['-c', 'print(1)'], stdin: null })
  assert.equal(R.parseRunOnce({ language: 'js', code: '1' }).cmd, 'node')
  assert.deepEqual(R.parseRunOnce({ language: 'bash', code: 'echo hi', stdin: 'x' }).args, ['-c', 'echo hi'])
  for (const bad of [null, {}, { language: 'ruby', code: 'x' }, { language: 'python', code: '' }, { language: 'python', code: 'x'.repeat(20_001) }, { language: 'python', code: 'x', stdin: 5 }]) {
    assert.throws(() => R.parseRunOnce(bad), R.RunInputError)
  }
  assert.equal(PR.agentToolUsd('run'), 0.02)
  const tools = readFileSync(new URL('lib/agents/agent-tools.ts', ROOT), 'utf8')
  const run = tools.slice(tools.indexOf('export async function runOnce'))
  assert.match(run, /network: 'none', env: \{\}/)
  assert.match(run, /QBOX_DISABLED/)
  assert.match(run, /admitCreate\(/)
  assert.ok(run.indexOf("from('qbox_sandboxes').insert") < run.indexOf('engine().create'), 'row before the engine')
  assert.match(run, /finally \{\s*await engine\(\)\.kill\(id\)/)
  // the site MCP server never runs code
  const mcp = readFileSync(new URL('lib/agents/mcp.ts', ROOT), 'utf8')
  assert.ok(!/runOnce|'run'/.test(mcp))
})

test('routes: x402 or Bearer through one helper; bad input is refused before any payment', () => {
  const helper = readFileSync(new URL('lib/agents/paid-route.ts', ROOT), 'utf8')
  assert.match(helper, /if \(!hasApiKey\(req\)\) return payPerCall\(req, t, work\)/)
  assert.match(helper, /await refund\(c, t\.tool, booked\.ref\)/)
  for (const [route, tool] of [['store', 'STORE_HTTP_TOOL'], ['company', 'COMPANY_HTTP_TOOL'], ['check', 'CHECK_HTTP_TOOL'], ['run', 'RUN_HTTP_TOOL']]) {
    const src = readFileSync(new URL(`app/api/agent/v1/${route}/route.ts`, ROOT), 'utf8')
    assert.ok(src.includes(`paidToolResponse(req, ${tool}`), route)
    assert.ok(src.indexOf('badRequest(') < src.indexOf('paidToolResponse(req'), `${route}: input checked first`)
  }
  const tools = readFileSync(new URL('lib/agents/agent-tools.ts', ROOT), 'utf8')
  // pages only through Qscan's SSRF-safe fetcher; registers on fixed hosts; never around bot walls
  assert.ok(!/fetch\(url\b|fetch\(`\$\{url/.test(tools))
  assert.match(tools, /https:\/\/ares\.gov\.cz\/ekonomicke-subjekty-v-be\/rest\/ekonomicke-subjekty\/\$\{q\.ico\}/)
  assert.match(tools, /https:\/\/ec\.europa\.eu\/taxation_customs\/vies\/rest-api\/ms\//)
  assert.match(tools, /We don't work around bot protection/)
})
