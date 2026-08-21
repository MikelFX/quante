// Store Health Score — computeStoreHealth() pure scoring logic.
// Usage: node --test __tests__/store-health.test.mjs
// Or via: npm run test:store-health
//
// Inlines a plain-JS copy of lib/store-health.ts (must stay in sync) — same convention as
// __tests__/fulfillment-byrd.test.mjs / __tests__/export-whitelabel.test.mjs, since these
// tests run via plain `node --test` without a TypeScript loader.
//
// 2026-08-21: rewritten alongside lib/store-health.ts's switch from the legacy
// ShopManifest (manifest_versions — never populated for code-gen mode stores) to
// project_secrets-backed BusinessInfo/PaymentsInfo/ShippingInfo + code_versions file
// presence for legal pages. See types/business.ts and MerchantPanel.tsx.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/store-health.ts (inlined copy) ─────────────────────────────────────────

function isValidTaxId(merchant) {
  if (!merchant.taxId?.trim()) return false
  if (merchant.country === 'CZ') return /^\d{8}$/.test(merchant.taxId.trim())
  return true
}

function computeStoreHealth(input) {
  const { merchant, payments, shipping, legalPagesPresent, products, hasCookieConsent, deployment, emailTestSentAt } = input

  const merchantComplete = !!(
    merchant &&
    merchant.name?.trim() &&
    isValidTaxId(merchant) &&
    merchant.street?.trim() &&
    merchant.city?.trim() &&
    merchant.postalCode?.trim() &&
    merchant.email?.trim()
  )

  const legalPagesDone = legalPagesPresent >= 4

  const paymentActive = !!(
    payments &&
    ((payments.providers?.length ?? 0) > 0 ||
      payments.cod?.enabled ||
      payments.bankTransfer?.enabled)
  )

  const shippingMethods = shipping?.methods ?? []
  const shippingDone = shippingMethods.length > 0 && shippingMethods.every((sm) => typeof sm.price === 'number' && sm.price >= 0)

  const emailTested = !!emailTestSentAt

  const productList = products ?? []
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

function fullMerchant() {
  return {
    name: 'Nova Coffee Ltd.',
    taxId: '12345678',
    vatId: 'CZ12345678',
    vatRegistered: true,
    country: 'CZ',
    street: 'Main St 1',
    city: 'Prague',
    postalCode: '11000',
    email: 'info@novacoffee.example',
    phone: '+420123456789',
    bankAccount: '123456789/0800',
    responsiblePerson: '',
  }
}

function fullPayments() {
  return { providers: [], cod: { enabled: false, fee: 0 }, bankTransfer: { enabled: true, qr: true } }
}

function fullShipping() {
  return { methods: [{ id: 'zasilkovna', label: 'Zásilkovna / Packeta', price: 79 }], pickupEnabled: false, freeShippingFrom: 0 }
}

function fullProducts() {
  return [{ id: '1', name: 'Espresso', price: 89, images: ['x.jpg'], available: true, slug: 'espresso' }]
}

// ─── tests ───────────────────────────────────────────────────────────────────────

test('empty project scores 0 and is not ready to sell', () => {
  const result = computeStoreHealth({
    merchant: null,
    payments: null,
    shipping: null,
    legalPagesPresent: 0,
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
    merchant: fullMerchant(),
    payments: fullPayments(),
    shipping: fullShipping(),
    legalPagesPresent: 4,
    products: fullProducts(),
    hasCookieConsent: true,
    deployment: { ...emptyDeployment(), status: 'ready' },
    emailTestSentAt: new Date().toISOString(),
  })
  assert.equal(result.score, 100)
  assert.equal(result.readyToSell, true)
  assert.equal(result.doneCount, 7)
  assert.equal(result.live.isLive, true)
})

test('invalid IČO (not 8 digits, CZ) fails the merchant check', () => {
  const merchant = { ...fullMerchant(), taxId: '123' }
  const result = computeStoreHealth({ merchant, payments: null, shipping: null, legalPagesPresent: 0, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'merchant').done, false)
})

test('non-CZ merchant only needs a non-empty tax id, not an 8-digit IČO', () => {
  const merchant = { ...fullMerchant(), country: 'US', taxId: 'EIN-98-7654321' }
  const result = computeStoreHealth({ merchant, payments: null, shipping: null, legalPagesPresent: 0, products: null, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'merchant').done, true)
})

test('partial legal pages (3 of 4) do not count as done, but are tracked', () => {
  const result = computeStoreHealth({ merchant: fullMerchant(), payments: fullPayments(), shipping: fullShipping(), legalPagesPresent: 3, products: fullProducts(), hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  const legal = result.items.find((i) => i.id === 'legal_pages')
  assert.equal(legal.done, false)
  assert.equal(legal.legalPagesPresent, 3)
})

test('shipping method with a negative price does not count as done', () => {
  const shipping = { methods: [{ id: 'zasilkovna', label: 'Zásilkovna', price: -1 }], pickupEnabled: false, freeShippingFrom: 0 }
  const result = computeStoreHealth({ merchant: fullMerchant(), payments: fullPayments(), shipping, legalPagesPresent: 4, products: fullProducts(), hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'shipping').done, false)
})

test('product without a photo does not satisfy the product checklist item', () => {
  const products = [{ id: '1', name: 'Espresso', price: 89, images: [], available: true, slug: 'espresso' }]
  const result = computeStoreHealth({ merchant: fullMerchant(), payments: fullPayments(), shipping: fullShipping(), legalPagesPresent: 4, products, hasCookieConsent: true, deployment: null, emailTestSentAt: null })
  assert.equal(result.items.find((i) => i.id === 'product').done, false)
})

test('a verified custom domain is surfaced in live.url over the raw deployment domain', () => {
  const result = computeStoreHealth({
    merchant: fullMerchant(), payments: fullPayments(), shipping: fullShipping(), legalPagesPresent: 4, products: fullProducts(),
    hasCookieConsent: true,
    deployment: { status: 'ready', domain: 'foo.quante.app', customDomain: 'novacoffee.example', customDomainVerified: true },
    emailTestSentAt: null,
  })
  assert.equal(result.live.url, 'novacoffee.example')
})

test('an unverified custom domain falls back to the raw deployment domain', () => {
  const result = computeStoreHealth({
    merchant: fullMerchant(), payments: fullPayments(), shipping: fullShipping(), legalPagesPresent: 4, products: fullProducts(),
    hasCookieConsent: true,
    deployment: { status: 'ready', domain: 'foo.quante.app', customDomain: 'novacoffee.example', customDomainVerified: false },
    emailTestSentAt: null,
  })
  assert.equal(result.live.url, 'foo.quante.app')
  assert.equal(result.live.hasCustomDomain, false)
})
