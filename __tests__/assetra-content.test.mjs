// AssetraDigital website content rules (content/assetra/*): module status vs. app entry,
// no promised dates for modules in development, and prices read from the charging code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    // extensionless relative imports between .ts files (bundler resolution)
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

const { modules, quanteFlow } = await import('../content/assetra/modules.ts')
const { quantePricing, moduleCosts, kredity, usd } = await import('../content/assetra/quante-pricing.ts')
const { CREDIT_COSTS, HOSTING_ANNUAL_USD, AGENCY_MONTHLY_USD } = await import('../lib/config.ts')
const { CREDIT_PACKS } = await import('../lib/credit-packs.ts')

test('only shipping modules have a way into the app', () => {
  const live = modules.filter((m) => m.status === 'live').map((m) => m.slug).sort()
  assert.deepEqual(live, ['generate', 'qads', 'qdit', 'qgent']) // verified against the code 2026-10-08 (Qgent: Studio → Qgent)
  for (const m of modules) {
    if (m.status === 'live') assert.ok(m.app?.href, `${m.slug} needs an app entry`)
    else assert.equal(m.app, undefined, `${m.slug} is in development and must not link into the app`)
  }
})

test('modules in development promise no dates and say they are in development', () => {
  const dateLike = /\b(20\d\d|leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec|Q[1-4]|brzy|do konce)\b/i
  for (const m of modules.filter((x) => x.status === 'dev')) {
    const text = [m.short, m.lead, m.note ?? '', ...m.features.flatMap((f) => [f.title, f.text])].join(' ')
    assert.doesNotMatch(text, dateLike, m.slug)
    assert.match(m.note ?? '', /ve vývoji/i, m.slug)
  }
})

test('every module link and flow step points to a real module', () => {
  const slugs = new Set(modules.map((m) => m.slug))
  for (const m of modules) for (const l of m.links) assert.ok(slugs.has(l.to), `${m.slug} → ${l.to}`)
  assert.deepEqual(new Set(quanteFlow.map((f) => f.slug)), slugs)
})

test('Quante prices come from the code that charges them', () => {
  assert.equal(quantePricing.packs.length, CREDIT_PACKS.length)
  CREDIT_PACKS.forEach((p, i) => {
    assert.equal(quantePricing.packs[i].credits, p.credits)
    assert.equal(quantePricing.packs[i].price, usd(p.priceCents))
  })
  assert.equal(quantePricing.welcomeCredits, CREDIT_COSTS.welcome_grant)
  assert.equal(quantePricing.hosting.annualUsd, HOSTING_ANNUAL_USD)
  assert.equal(quantePricing.agency.monthlyUsd, AGENCY_MONTHLY_USD)
  const gen = moduleCosts('generate').find((c) => c.label === 'Vygenerování e-shopu')
  assert.equal(gen.value, kredity(CREDIT_COSTS.generate))
})

test('Czech plural of kredit and USD formatting', () => {
  assert.equal(kredity(1), '1 kredit')
  assert.equal(kredity(3), '3 kredity')
  assert.equal(kredity(10), '10 kreditů')
  assert.equal(usd(999), '9,99')
  assert.equal(usd(6999), '69,99')
})
