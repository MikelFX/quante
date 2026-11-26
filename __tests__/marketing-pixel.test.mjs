// ChatGPT Ads pixel (lib/marketing-pixel.ts, owner 2026-11-25): quantecode.com only, never the
// website, a store preview or a supplier/invoice link, and only after marketing consent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = await import('../lib/marketing-pixel.ts')
const src = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8')

test('only on quantecode.com', () => {
  assert.equal(M.pixelAllowed('quantecode.com', '/'), true)
  assert.equal(M.pixelAllowed('www.quantecode.com', '/qads'), true)
  assert.equal(M.pixelAllowed('quantecode.com', '/dashboard'), true)
  assert.equal(M.pixelAllowed('assetradigital.agency', '/'), false)
  assert.equal(M.pixelAllowed('www.assetradigital.agency', '/web-eshop'), false)
  assert.equal(M.pixelAllowed('quante-git-x.vercel.app', '/'), false)
  assert.equal(M.pixelAllowed('localhost', '/'), false)
  assert.equal(M.pixelAllowed('shop.stores.quantecode.com', '/'), false)
  assert.equal(M.pixelAllowed('evilquantecode.com', '/'), false)
})

test('never on a store preview, supplier order or invoice', () => {
  for (const p of ['/preview/abc', '/preview/demo', '/supplier-order/1', '/invoice/2', '/preview']) {
    assert.equal(M.pixelAllowed('quantecode.com', p), false, p)
  }
  assert.equal(M.pixelAllowed('quantecode.com', '/previews-are-not-this'), true)
})

test('consent is parsed strictly', () => {
  assert.equal(M.parseConsent(null), null)
  assert.equal(M.parseConsent('yes'), null)
  assert.equal(M.parseConsent('{"marketing":"true","at":"x"}'), null)
  assert.deepEqual(M.parseConsent(M.consentValue(true, new Date(0))), { marketing: true, at: '1970-01-01T00:00:00.000Z' })
  assert.equal(M.parseConsent(M.consentValue(false)).marketing, false)
})

test('bootstrap: OpenAI SDK, consent before init, pixel id, debug off by default', () => {
  const s = M.pixelBootstrap('PID', false)
  assert.match(s, /https:\/\/bzrcdn\.openai\.com\/sdk\/oaiq\.min\.js/)
  assert.ok(s.indexOf('oaiq("consent",true)') < s.indexOf('oaiq("init"'))
  assert.match(s, /"pixelId":"PID","debug":false/)
  assert.equal(M.OAI_PIXEL_DEBUG, false)
  assert.match(M.pixelBootstrap('PID', true), /"debug":true/)
})

test('copy follows the page language', () => {
  assert.equal(M.consentCopy('/').accept, 'Povolit marketing')
  assert.equal(M.consentCopy('/quante/qads').reject, 'Jen nezbytné')
  assert.equal(M.consentCopy('/en').accept, 'Allow marketing')
  assert.equal(M.consentCopy('/dashboard').accept, 'Allow marketing')
})

test('wired once in the root layout; never in the store template', () => {
  assert.match(src('app/layout.tsx'), /<MarketingConsent \/>/)
  const c = src('components/consent/MarketingConsent.tsx')
  assert.match(c, /stored\?\.marketing &&/)
  assert.match(c, /pixelAllowed\(/)
  assert.doesNotMatch(src('lib/store-template/build.ts'), /oaiq|bzrcdn/)
})
