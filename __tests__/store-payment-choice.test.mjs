// Payment choice in AI-built (code-gen) stores, scaffold 7 (2026-11-25): the cart offers the
// merchant's payment methods (/api/store/shipping → `payments`), the success page shows a
// bank-transfer order's verified details through the locked app/api/order-status proxy.
// Usage: node --test __tests__/store-payment-choice.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const B = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)
const I = await import(new URL('../lib/agent-shops/store-info.ts', import.meta.url).href)
const SRC = readFileSync(new URL('../lib/store-template/build.ts', import.meta.url), 'utf8')

test('only gateways with the merchant’s own credentials are offered; card always', () => {
  const offered = new Set(['stripe', 'paypal', 'comgate', 'gopay'])
  assert.deepEqual([...I.usableOnlineMethods(offered, { comgate: false, gopay: true, paypal: false })].sort(), ['gopay', 'stripe'])
  assert.deepEqual([...I.usableOnlineMethods(new Set(['stripe']), { comgate: true, gopay: true, paypal: true })], ['stripe'])
  const pays = I.offeredPayments({ onlineMethods: new Set(['stripe']), bankTransferEnabled: true, cod: { enabled: true, feeCents: 4900 } })
  assert.deepEqual(pays.map((p) => [p.id, p.kind, p.fee]), [['stripe', 'online', 0], ['prevod', 'bank_transfer', 0], ['dobirka', 'cash_on_delivery', 49]])
})

test('scaffold 7: the cart sends the picked method and the success page reads verified details', () => {
  assert.ok(B.SCAFFOLD_VERSION >= 7)
  const files = B.getEditableScaffoldFiles()
  const cart = files['app/cart/page.tsx']
  assert.match(cart, /paymentMethod: selectedPay\?\.id/)
  assert.match(cart, /d\.payments/)
  assert.equal(B.rejectAiStoreFile('app/cart/page.tsx', cart), null)
  const success = files['app/success/page.tsx']
  assert.match(success, /\/api\/order-status\?/)
  assert.doesNotMatch(success, /get\('account'\)|get\('amount'\)|get\('vs'\)/, 'payment details never come from the URL')
  assert.equal(B.rejectAiStoreFile('app/success/page.tsx', success), null)
  assert.ok(B.rejectAiStoreFile('app/api/order-status/route.ts', 'export {}'), 'the proxy stays platform code')
  assert.ok(B.PLATFORM_LOCKED_FILES.has('app/api/order-status/route.ts'))
})

test('every i18n key the cart and success page use exists in English and Czech', () => {
  const files = B.getEditableScaffoldFiles()
  const used = new Set()
  for (const f of ['app/cart/page.tsx', 'app/success/page.tsx']) for (const m of files[f].matchAll(/\bt\('(\w+)'\)/g)) used.add(m[1])
  for (const m of files['app/cart/page.tsx'].matchAll(/: '(pay\w+)'/g)) used.add(m[1])
  const i18n = SRC.slice(SRC.indexOf("add('lib/i18n.ts'"), SRC.indexOf('function resolveLang()'))
  const en = i18n.slice(i18n.indexOf('  en: {'), i18n.indexOf('  cs: {'))
  const cs = i18n.slice(i18n.indexOf('  cs: {'))
  for (const k of used) {
    assert.match(i18n, new RegExp(`'${k}'`), `${k} missing from StringKey`)
    assert.match(en, new RegExp(`\\b${k}: '`), `${k} missing in en`)
    assert.match(cs, new RegExp(`\\b${k}: '`), `${k} missing in cs`)
  }
})
