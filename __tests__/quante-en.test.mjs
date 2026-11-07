// English Quante pages (quantecode.com/en, owner 2026-11-07) and the page language rule: the English
// copy covers every Czech module word for word in structure, prices come from the same code, and
// <html lang> / Content-Language follow the path.
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

const M = await import('../content/assetra/modules.ts')
const EN = await import('../content/assetra/modules-en.ts')
const P = await import('../content/assetra/quante-pricing.ts')
const D = await import('../lib/domains.ts')
const { LANG_SCRIPT } = await import('../lib/lang-script.ts')
const { CREDIT_COSTS } = await import('../lib/config.ts')
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')

const czech = /[ěščřžůĚŠČŘŽŮ]/

test('every module has English copy with the same shape and hand-overs', () => {
  for (const m of M.modules) {
    const en = EN.MODULES_EN[m.slug]
    assert.ok(en, m.slug)
    assert.equal(en.features.length, m.features.length, m.slug)
    assert.deepEqual(Object.keys(en.links).sort(), m.links.map((l) => l.to).sort(), m.slug)
    assert.equal(!!en.note, !!m.note, m.slug)
    assert.equal(!!en.appLabel, !!m.app, m.slug)
    assert.equal(!!en.badge, !!m.badge, m.slug)
  }
  for (const m of M.modulesFor('en')) {
    for (const s of [m.short, m.tag, m.lead, m.note ?? '', ...m.features.flatMap((f) => [f.title, f.text]), ...m.links.map((l) => l.text), m.app?.label ?? '']) {
      assert.doesNotMatch(s.replace('Zásilkovna', ''), czech, `${m.slug}: ${s}`)
    }
  }
  // status, order and app entries are the Czech data's — the English file only translates
  assert.deepEqual(M.modulesFor('en').map((m) => [m.slug, m.status, m.app?.href]), M.modules.map((m) => [m.slug, m.status, m.app?.href]))
})

test('English flow, start and status line', () => {
  assert.deepEqual(M.quanteFlowFor('en').map((f) => f.slug), M.quanteFlow.map((f) => f.slug))
  assert.deepEqual(M.quanteStartFor('en').goals.map((g) => [g.goal, g.href]), M.quanteStart.goals.map((g) => [g.goal, g.href]))
  for (const g of M.quanteStartFor('en').goals) assert.doesNotMatch(g.title + g.text, czech)
  assert.match(M.modulesStatusLine('en'), /^Five modules work and you can use them today\. Qails is in development\.$/)
})

test('English prices come from the same code', () => {
  const gen = P.moduleCostsEn('generate').find((c) => c.label === 'Generating a store')
  assert.equal(gen.value, P.creditsEn(CREDIT_COSTS.generate))
  assert.equal(P.quantePricingEn.packs.length, P.quantePricing.packs.length)
  P.quantePricingEn.packs.forEach((p, i) => assert.equal(p.price, P.quantePricing.packs[i].price.replace(',', '.')))
  assert.equal(P.quantePricingEn.costs.length, P.quantePricing.costs.length)
  for (const slug of ['generate', 'qscan', 'qgent', 'qdit', 'qads', 'qails']) {
    assert.equal(P.moduleCostsEn(slug).length, P.moduleCosts(slug).length, slug)
  }
})

test('the language switch maps every page to its pair', () => {
  assert.equal(M.otherLocalePath('/', 'cs'), '/en')
  assert.equal(M.otherLocalePath('/quante', 'cs'), '/en')
  assert.equal(M.otherLocalePath('/quante/qgent', 'cs'), '/en/qgent')
  assert.equal(M.otherLocalePath('/en', 'en'), '/quante')
  assert.equal(M.otherLocalePath('/en/qads', 'en'), '/quante/qads')
  assert.equal(M.otherLocalePath('/en/nope', 'en'), '/quante')
  assert.equal(M.moduleHref({ slug: 'qads' }, 'en'), '/en/qads')
})

test('page language: website + Quante Czech, /en and the app English', () => {
  for (const p of ['/', '/web-eshop', '/obchodni-podminky', '/quante', '/quante/qads']) assert.equal(D.pageLang(p), 'cs', p)
  for (const p of ['/en', '/en/qads', '/qads', '/qbox', '/dashboard', '/terms']) assert.equal(D.pageLang(p), 'en', p)
  assert.ok(D.isClerkFreePage('/en') && D.isClerkFreePage('/en/qgent'))
  // the pre-paint script runs the same rule in the browser
  const run = (pathname) => {
    const el = { lang: 'en' }
    new Function('location', 'document', LANG_SCRIPT)({ pathname }, { documentElement: el })
    return el.lang
  }
  for (const p of ['/', '/web-eshop', '/quante/qads', '/en', '/en/qads', '/qads', '/dashboard', '/design']) assert.equal(run(p), D.pageLang(p), p)
  assert.match(read('app/layout.tsx'), /LANG_SCRIPT/)
  const cfg = read('next.config.ts')
  assert.match(cfg, /Content-Language', value: 'cs'/)
  assert.match(cfg, /Content-Language', value: 'en'/)
  assert.match(cfg, /source: '\/en', has: \[\{ type: 'host', value: SITE_HOST_PATTERN \}\], destination: APP_ORIGIN \+ '\/en'/)
})

test('English pages send hreflang pairs and are in the sitemap', () => {
  assert.match(read('app/(site)/(quante)/en/page.tsx'), /alternate: \{ cs: '\/', en: '\/en' \}/)
  assert.match(read('app/(site)/(quante)/quante/page.tsx'), /alternate: \{ cs: '\/', en: '\/en' \}/)
  assert.match(read('app/(site)/(quante)/en/[modul]/page.tsx'), /alternate: \{ cs: `\/quante\/\$\{m\.slug\}`, en: `\/en\/\$\{m\.slug\}` \}/)
  assert.match(read('app/(site)/_components/seo.ts'), /'x-default': alternate\.cs/)
  assert.match(read('app/sitemap.ts'), /path: '\/en'/)
})
