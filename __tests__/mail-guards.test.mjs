// Mail guards (final audit F3 / F8 and the reviewer follow-ups): link-free merchant /
// shopper text in store mails, From display names, carrier-only tracking buttons, the
// merchant new-order notice, and the Studio ship transition rules.
// Usage: node --test __tests__/mail-guards.test.mjs
//
// Imports the real lib/email-templates.ts and app/api/projects/[id]/store-orders/_lib/
// ship-rules.ts through Node's built-in TypeScript type stripping (Node >= 22.18). Their
// only value import is '@/lib/html', mapped to the repo root by the resolve hook below.

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
    return nextResolve(specifier, context)
  },
})

const T = await import(new URL('../lib/email-templates.ts', import.meta.url).href)
const R = await import(new URL('../app/api/projects/[id]/store-orders/_lib/ship-rules.ts', import.meta.url).href.replace('%5Bid%5D', '[id]'))

const cp = (n) => String.fromCodePoint(n)
const HOST_DOT = cp(0xB7)

// Text (with tags stripped) contains no linkable host: no "x.y" with a letter after the
// dot, no dotted IPv4 address, no scheme / www.
function assertNoLinkableHost(text, label) {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  assert.doesNotMatch(plain, /[\p{L}\p{N}_-]\.\p{L}/u, `${label}: bare domain left in ${JSON.stringify(plain.slice(0, 200))}`)
  assert.doesNotMatch(plain, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, `${label}: IPv4 host left`)
  assert.doesNotMatch(plain, /[a-z][a-z0-9+.-]*:\/\//i, `${label}: scheme URL left`)
  assert.doesNotMatch(plain, /\bwww\./i, `${label}: www. host left`)
}

// ─── linkFreeText ────────────────────────────────────────────────────────────

test('linkFreeText removes scheme URLs, www. hosts and javascript:/mailto: tokens', () => {
  const s = T.linkFreeText('Sleva https://evil.example/login www.evil.example javascript:alert(1) mailto:a@b.example konec', 200)
  assert.equal(s.includes('://'), false)
  assert.equal(/www\./i.test(s), false)
  assert.equal(/javascript:|mailto:/i.test(s), false)
  assert.match(s, /^Sleva .*konec$/)
})

test('linkFreeText neutralises bare domains (bypass: ZWSP-only defence)', () => {
  const s = T.linkFreeText('Visit evil.example/login now', 200)
  assert.equal(s, `Visit evil${HOST_DOT}example/login now`)
  assert.equal(s.includes(cp(0x200B)), false, 'no zero-width space reliance')
})

test('linkFreeText neutralises bare IPv4 hosts (bypass: 45.12.3.4/login)', () => {
  const s = T.linkFreeText('Pay at 45.12.3.4/login', 200)
  assert.equal(s, `Pay at 45${HOST_DOT}12${HOST_DOT}3${HOST_DOT}4/login`)
})

test('linkFreeText neutralises full-width and ideographic dots (bypass: evil．com, evil。com, evil｡com)', () => {
  for (const dot of [0xFF0E, 0x3002, 0xFF61]) {
    const s = T.linkFreeText(`evil${cp(dot)}com/pay`, 200)
    assert.equal(s, `evil${HOST_DOT}com/pay`, `dot U+${dot.toString(16)}`)
  }
})

test('linkFreeText neutralises full-width scheme and www (NFKC)', () => {
  const s = T.linkFreeText(`ｈｔｔｐｓ://evil.example ｗｗｗ.evil.example ok`, 200)
  assert.equal(s, 'ok')
})

test('linkFreeText drops zero-width / bidi characters used to split a link', () => {
  const s = T.linkFreeText(`evil${cp(0x200B)}.com and ${cp(0x202E)}moc.live`, 200)
  assertNoLinkableHost(s, 'zwsp/bidi')
})

test('linkFreeText neutralises non-ASCII (IDN) labels', () => {
  const s = T.linkFreeText('pаypаl.com', 200) // Cyrillic а
  assertNoLinkableHost(s, 'idn')
})

test('linkFreeText keeps ordinary text readable', () => {
  assert.equal(T.linkFreeText('Mr. Smith - Tričko No.5, 1.5 kg, v2.0', 200), 'Mr. Smith - Tričko No.5, 1.5 kg, v2.0')
  assert.equal(T.linkFreeText('Kávovar.cz', 80), `Kávovar${HOST_DOT}cz`)
})

test('linkFreeText caps the length', () => {
  const s = T.linkFreeText('x'.repeat(500), 80)
  assert.equal(s.length, 80)
  assert.ok(s.endsWith('…'))
})

// ─── From display name ───────────────────────────────────────────────────────

test('sanitizeDisplayName drops bare domains (bypass: "paypal.com Security")', () => {
  assert.equal(T.sanitizeDisplayName('paypal.com Security'), 'paypal Security')
  assert.equal(T.sanitizeDisplayName(`paypal${cp(0xFF0E)}com Security`), 'paypal Security')
  assert.equal(T.sanitizeDisplayName(`paypal${cp(0x3002)}com Security`), 'paypal Security')
  assert.equal(T.sanitizeDisplayName('45.12.3.4 Support'), 'Support')
  assert.equal(T.sanitizeDisplayName('support@bank.example'), 'support bank')
  assert.equal(T.sanitizeDisplayName('https://evil.example Shop'), 'Shop')
})

test('sanitizeDisplayName keeps normal store names and blocks Quante impersonation', () => {
  assert.equal(T.sanitizeDisplayName('Kávovar Brno'), 'Kávovar Brno')
  assert.equal(T.sanitizeDisplayName('Mr. Smith Shop'), 'Mr. Smith Shop')
  assert.equal(T.sanitizeDisplayName('Ｑｕａｎｔｅ Support'), '')
  assert.equal(T.sanitizeDisplayName('A "b" <c>'), 'A b c')
})

// ─── Customer mails ──────────────────────────────────────────────────────────

const EVIL = `Klikni evil.example/login 45.12.3.4/x evil${cp(0x3002)}com https://evil.example`

test('order confirmation: product names capped at 80 chars and link-free', () => {
  const long = 'Produkt ' + 'a'.repeat(300) + ' evil.example'
  const { html, subject } = T.orderConfirmationEmail({
    orderNumber: '2026-0001', customerName: EVIL, customerEmail: 'c@example.com',
    items: [{ name: EVIL, quantity: 1, price: 10, currency: 'CZK' }, { name: long, quantity: 1, price: 5, currency: 'CZK' }],
    subtotal: 15, shippingCost: 0, dobirkaFee: 0, total: 15, currency: 'CZK', paymentMethod: 'prevod',
    shippingAddress: { ulice: EVIL, mesto: EVIL, psc: '11000' },
    storeName: EVIL, accentColor: '#123456', merchantEmail: null, merchantName: EVIL, bankovniUcet: EVIL,
  })
  assertNoLinkableHost(html, 'confirmation html')
  assertNoLinkableHost(subject, 'confirmation subject')
  assert.equal(html.includes('a'.repeat(81)), false, 'product name capped')
  assert.equal(/href="(?!mailto:)/.test(html), false, 'no link other than a merchant mailto')
})

test('shipped mail: tracking button only for carrier hosts (bypass: merchant-chosen https URL)', () => {
  const base = { orderNumber: '2026-0002', customerName: 'Jan', storeName: 'Shop', accentColor: '#000', merchantEmail: null, merchantName: 'Shop' }
  const evil = T.shippingEmail({ ...base, trackingUrl: 'https://evil.example/track', trackingCode: 'ABC123', carrier: 'PPL' })
  assert.equal(evil.html.includes('evil.example'), false)
  assert.equal(evil.html.includes('Sledovat zásilku'), false)
  assert.match(evil.html, /ABC123/)

  const lookalike = T.shippingEmail({ ...base, trackingUrl: 'https://packeta.com.evil.example/x' })
  assert.equal(lookalike.html.includes('Sledovat zásilku'), false)
  const suffix = T.shippingEmail({ ...base, trackingUrl: 'https://notpacketa.com/x' })
  assert.equal(suffix.html.includes('Sledovat zásilku'), false)
  const http = T.shippingEmail({ ...base, trackingUrl: 'http://tracking.packeta.com/cs/?id=Z1' })
  assert.equal(http.html.includes('Sledovat zásilku'), false)
  const creds = T.shippingEmail({ ...base, trackingUrl: 'https://tracking.packeta.com@evil.example/' })
  assert.equal(creds.html.includes('Sledovat zásilku'), false)

  for (const ok of [
    'https://tracking.packeta.com/cs/?id=Z1234567890',
    'https://gls-group.eu/GROUP/en/parcel-tracking?match=123',
    'https://www.dhl.com/en/express/tracking.html?AWB=1&brand=DHL',
  ]) {
    const m = T.shippingEmail({ ...base, trackingUrl: ok })
    assert.ok(m.html.includes('Sledovat zásilku'), ok)
  }
})

test('shipped mail: carrier, tracking code, customer and store names are link-free', () => {
  const { html, subject } = T.shippingEmail({
    orderNumber: '2026-0003', customerName: EVIL, storeName: EVIL, accentColor: '#000',
    merchantEmail: null, merchantName: EVIL, trackingCode: EVIL, carrier: EVIL,
  })
  assertNoLinkableHost(html, 'shipped html')
  assertNoLinkableHost(subject, 'shipped subject')
})

test('refund and payment mails: customer name link-free', () => {
  const d = { orderNumber: '2026-0004', customerName: EVIL, total: 1, currency: 'CZK', storeName: 'S', accentColor: '#000', merchantEmail: null, merchantName: 'S' }
  assertNoLinkableHost(T.refundEmail(d).html, 'refund')
  assertNoLinkableHost(T.paymentConfirmedEmail(d).html, 'payment')
})

// ─── Merchant mails (unverified merchant address) ────────────────────────────

test('merchant new-order notice is link-free and caps product names (bypass: merchantEmail = victim)', () => {
  const { html, subject } = T.merchantNewOrderEmail({
    orderNumber: '2026-0005', customerName: EVIL, customerEmail: 'c@example.com', customerPhone: EVIL,
    items: [{ name: EVIL + ' ' + 'b'.repeat(300), quantity: 2, price: 10, currency: 'CZK' }],
    total: 20, currency: 'CZK', paymentMethod: 'dobirka', shippingMethod: EVIL,
    shippingAddress: { ulice: EVIL, mesto: EVIL, psc: '11000', zeme: EVIL },
    storeName: EVIL, accentColor: '#000',
  })
  // The shopper's own (validated) address is the one expected domain in the notice.
  assertNoLinkableHost(html.replace('c@example.com', ''), 'merchant notice html')
  assertNoLinkableHost(subject, 'merchant notice subject')
  assert.equal(html.includes('b'.repeat(81)), false, 'product name capped')
  assert.equal(/href=/.test(html), false)
})

test('merchant low-stock mail is link-free', () => {
  const { html, subject } = T.merchantLowStockEmail({ productName: EVIL, variantName: EVIL, stockQty: 1, threshold: 2, storeName: EVIL, accentColor: '#000' })
  assertNoLinkableHost(html, 'low stock html')
  assertNoLinkableHost(subject, 'low stock subject')
})

// ─── Studio ship transitions (F3) ────────────────────────────────────────────

test('shipRefusal: allowed transitions', () => {
  assert.equal(R.shipRefusal({ status: 'paid', payment_status: 'paid', payment_method: 'stripe' }), null)
  assert.equal(R.shipRefusal({ status: 'paid', payment_status: 'pending', payment_method: 'dobirka' }), null)
  assert.equal(R.shipRefusal({ status: 'pending', payment_status: 'pending', payment_method: 'dobirka' }), null)
  assert.equal(R.shipRefusal({ status: 'pending', payment_status: 'pending', payment_method: 'prevod' }), null)
})

test('shipRefusal: rejected transitions (bypass: unpaid online order mailed as shipped)', () => {
  for (const o of [
    { status: 'pending', payment_status: 'pending', payment_method: 'stripe' },
    { status: 'pending', payment_status: null, payment_method: 'comgate' },
    { status: 'paid', payment_status: 'test_paid', payment_method: 'stripe' },
    { status: 'paid', payment_status: 'pending', payment_method: 'gopay' },
    { status: 'cancelled', payment_status: 'failed', payment_method: 'stripe' },
    { status: 'cancelled', payment_status: 'pending', payment_method: 'dobirka' },
    { status: 'refunded', payment_status: 'refunded', payment_method: 'stripe' },
    { status: 'shipped', payment_status: 'paid', payment_method: 'stripe' },
  ]) {
    assert.ok(R.shipRefusal(o), JSON.stringify(o))
  }
})

test('safeTrackingUrl: https only, no credentials, no javascript:', () => {
  assert.equal(R.safeTrackingUrl('https://tracking.packeta.com/cs/?id=Z1'), 'https://tracking.packeta.com/cs/?id=Z1')
  assert.equal(R.safeTrackingUrl('http://tracking.packeta.com/'), undefined)
  assert.equal(R.safeTrackingUrl('javascript:alert(1)'), undefined)
  assert.equal(R.safeTrackingUrl('https://a@evil.example/'), undefined)
})
