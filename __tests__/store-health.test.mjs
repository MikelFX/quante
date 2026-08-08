// Store Health Score — computeStoreHealth() pure scoring logic.
// Usage: node --test __tests__/store-health.test.mjs
// Or via: npm run test:store-health
//
// Inlines a plain-JS copy of lib/store-health.ts (must stay in sync) — same convention as
// __tests__/fulfillment-byrd.test.mjs / __tests__/export-whitelabel.test.mjs, since these
// tests run via plain `node --test` without a TypeScript loader.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/store-health.ts (inlined copy) ─────────────────────────────────────────

function isValidIco(ico) {
  return !!ico && /^\d{8}$/.test(ico.trim())
}

const LEGAL_SLUGS = ['obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'kontakt']

function computeStoreHealth(input) {
  const { manifest, products, hasCookieConsent, deployment, emailTestSentAt } = input
  const m = manifest?.merchant

  const merchantComplete = !!(
    m &&
    m.obchodni_nazev?.trim() &&
    isValidIco(m.ico) &&
    m.sidlo?.ulice?.trim() &&
    m.sidlo?.mesto?.trim() &&
    m.sidlo?.psc?.trim() &&
    m.kontakt?.email?.trim()
  )

  const customPageSlugs = new Set((manifest?.customPages ?? []).map((p) => p.slug))
  const legalPagesDone = LEGAL_SLUGS.every((slug) => customPageSlugs.has(slug))
  const legalPagesPresent = LEGAL_SLUGS.filter((slug) => customPageSlugs.has(slug)).length

  const payments = manifest?.payments
  const paymentActive = !!(
    payments &&
    ((payments.providers?.length ?? 0) > 0 ||
      payments.dobirka?.enabled ||
      payments.prevod?.enabled)
  )

  const shippingMethods = manifest?.shipping?.methods ?? []
  const shippingDone = shippingMethods.length > 0 && shippingMethods.every((sm) => typeof sm.cena_czk === 'number' && sm.cena_czk >= 0)

  const emailTested = !!emailTestSentAt

  const productList = products ?? manifest?.catalog?.products ?? []
  const sellableProduct = productList.find(
    (p) => p.images?.length > 0 && typeof p.price === 'number' && p.price > 0 && p.available
  )

  const cookieBarDone = hasCookieConsent

  const isLive = deployment?.status === 'ready'
  const hasCustomDomain = !!deployment?.customDomain && deployment.customDomainVerified

  const items = [
    { id: 'merchant', done: merchantComplete },
    { id: 'legal_pages', done: legalPagesDone, legalPagesPresent },
    { id: 'payment', done: paymentActive },
    { id: 'shipping', done: shippingDone },
    { id: 'email_test', done: emailTested },
    { id: 'product', done: !!sellableProduct },
    { id: 'cookie_bar', done: cookieBarDone },
  ]

  const doneCount = items.filter((i) => i.done).length
  const totalCount = items.length
  const score = Math.round((doneCount / totalCount) * 100)

  return {
    score,
    doneCount,
    totalCount,
    readyToSell: doneCount === totalCount,
    items,
    live: {
      isLive,
      url: deployment?.customDomain && deployment.customDomainVerified ? deployment.customDomain : deployment?.domain ?? null,
      hasCustomDomain,
    },
  }
}

// ─── fixtures ────────────────────────────────────────────────────────────────────

function emptyDeployment() {
  return { status: null, domain: null, customDomain: null, customDomainVerified: false }
}

function fullManifest() {
  return {
    merchant: {
      obchodni_nazev: 'Kavárna Nova s.r.o.',
      ico: '12345678',
      sidlo: { ulice: 'Hlavní 1', mesto: 'Praha', psc: '11000', zeme: 'CZ' },
      kontakt: { email: 'info@kavarna.cz', telefon: '+420123456789' },
    },
    customPages: LEGAL_SLUGS.map((slug) => ({ slug, title: slug, sections: [] })),
    payments: { providers: [], prevod: { enabled: true, qr: true } },
    shipping: { methods: [{ type: 'zasilkovna', cena_czk: 79 }] },
    catalog: {
      currency: 'CZK',
      products: [{ id: '1', name: 'Espresso', price: 89, images: ['x.jpg'], available: true, slug: 'espresso' }],
    },
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────────

test('empty project scores 0 and is not ready to sell', () => {
  const result = computeStoreHealth({
    manifest: null,
    products: null,
    hasCookieConsent: false,
    deployment: null,
    emailTestSentAt: null,
  })
  assert.equal(result.score, 0)
  assert.equal(result.readyToSell, false)
  assert.equal(result.doneCount, 0)
  assert.equal(result.totalCount, 7)
})

test('fully configured project scores 100 and is ready to sell', () => {
  const result = computeStoreHealth({
    manifest: fullManifest(),
    products: null,
    hasCookieConsent: true,
    deployment: { ...emptyDeployment(), status: 'ready' },
    emailTestSentAt: new Date().toISOString(),
  })
  assert.equal(result.score, 100)
  assert.equal(result.readyToSell, true)
  assert.equal(result.doneCount, 7)
  assert.equal(result.live.isLive, true)
})

test('invalid IČO (not 8 digits) fails the merchant check', () => {
  const manifest = fullManifest()
  manifest.merchant.ico = '123'
  const result = computeStoreHealth({ manifest, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'merchant').done, false)
})

test('partial legal pages (3 of 4) do not count as done, but are tracked', () => {
  const manifest = fullManifest()
  manifest.customPages = manifest.customPages.filter((p) => p.slug !== 'kontakt')
  const result = computeStoreHealth({ manifest, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  const legal = result.items.find((i) => i.id === 'legal_pages')
  assert.equal(legal.done, false)
  assert.equal(legal.legalPagesPresent, 3)
})

test('shipping method with a negative price does not count as done', () => {
  const manifest = fullManifest()
  manifest.shipping.methods = [{ type: 'zasilkovna', cena_czk: -1 }]
  const result = computeStoreHealth({ manifest, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'shipping').done, false)
})

test('product without a photo does not satisfy the product checklist item', () => {
  const manifest = fullManifest()
  manifest.catalog.products = [{ id: '1', name: 'Espresso', price: 89, images: [], available: true, slug: 'espresso' }]
  const result = computeStoreHealth({ manifest, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'product').done, false)
})

test('code-gen products (passed via `products`) take priority over manifest.catalog.products', () => {
  const manifest = fullManifest()
  manifest.catalog.products = [] // manifest has no products
  const products = [{ id: '9', name: 'Latte', price: 99, images: ['a.jpg'], available: true, slug: 'latte' }]
  const result = computeStoreHealth({ manifest, products, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'product').done, true)
})

test('a verified custom domain is surfaced in live.url over the raw deployment domain', () => {
  const result = computeStoreHealth({
    manifest: fullManifest(),
    products: null,
    hasCookieConsent: true,
    deployment: { status: 'ready', domain: 'foo.quante.app', customDomain: 'kavarna.cz', customDomainVerified: true },
    emailTestSentAt: null,
  })
  assert.equal(result.live.url, 'kavarna.cz')
})

test('an unverified custom domain falls back to the raw deployment domain', () => {
  const result = computeStoreHealth({
    manifest: fullManifest(),
    products: null,
    hasCookieConsent: true,
    deployment: { status: 'ready', domain: 'foo.quante.app', customDomain: 'kavarna.cz', customDomainVerified: false },
    emailTestSentAt: null,
  })
  assert.equal(result.live.url, 'foo.quante.app')
  assert.equal(result.live.hasCustomDomain, false)
})
