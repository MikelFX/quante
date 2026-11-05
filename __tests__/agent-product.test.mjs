// Pay-per-call product lookup for AI agents (lib/agents/product.ts, lib/agents/pay-per-call.ts):
// a product page's own structured data → normalized JSON; the x402 offer asks the exact price.
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

const P = await import('../lib/agents/product.ts')
const X = await import('../lib/qbox/x402.ts')
const PR = await import('../lib/agents/paid-price.ts')

const ld = (obj) => `<html lang="cs"><head><title>Shop</title><meta property="og:site_name" content="Kafe"><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body><h1>x</h1></body></html>`

test('JSON-LD product: price, currency, availability, brand, GTIN, rating', () => {
  const r = P.lookupProduct(ld({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Etiopie Yirgacheffe 250 g', sku: 'ETH-250', gtin13: '8594000000017',
    brand: { '@type': 'Brand', name: 'Kafe u Lípy' }, image: ['/img/eth.jpg'],
    aggregateRating: { ratingValue: '4.8', reviewCount: '37' },
    offers: { '@type': 'Offer', price: '289.00', priceCurrency: 'CZK', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' },
  }), 'https://shop.example/p/eth')
  assert.equal(r.found, true)
  assert.equal(r.source, 'json-ld')
  const p = r.products[0]
  assert.equal(p.name, 'Etiopie Yirgacheffe 250 g')
  assert.equal(p.price, 289)
  assert.equal(p.currency, 'CZK')
  assert.equal(p.availability, 'in_stock')
  assert.equal(p.condition, 'new')
  assert.equal(p.brand, 'Kafe u Lípy')
  assert.equal(p.sku, 'ETH-250')
  assert.equal(p.gtin, '8594000000017')
  assert.deepEqual(p.rating, { value: 4.8, count: 37 })
  assert.deepEqual(p.images, ['https://shop.example/img/eth.jpg'])
  assert.equal(r.site.name, 'Kafe')
})

test('availability: any in-stock offer wins; words and URLs normalize', () => {
  const r = P.lookupProduct(ld({ '@type': 'Product', name: 'Mlýnek', offers: [
    { price: 990, priceCurrency: 'EUR', availability: 'OutOfStock' }, { price: 1090, priceCurrency: 'EUR', availability: 'http://schema.org/InStock' },
  ] }), 'https://shop.example/p/m')
  assert.equal(r.products[0].availability, 'in_stock')
  assert.equal(r.products[0].price, 990)
  assert.equal(P.normalizeAvailability('https://schema.org/PreOrder'), 'preorder')
  assert.equal(P.normalizeAvailability('Sold out'), 'out_of_stock')
  assert.equal(P.normalizeAvailability('whatever'), null)
})

test('microdata and OpenGraph fallbacks; OpenGraph fills gaps', () => {
  const md = '<html><body><div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Konvička</h1><meta itemprop="price" content="450"><meta itemprop="priceCurrency" content="CZK"><link itemprop="availability" href="https://schema.org/OutOfStock"></div></body></html>'
  const a = P.lookupProduct(md, 'https://s.example/k')
  assert.equal(a.source, 'microdata')
  assert.equal(a.products[0].price, 450)
  assert.equal(a.products[0].availability, 'out_of_stock')

  const og = '<html><head><meta property="og:type" content="product"><meta property="og:title" content="Hrnek"><meta property="product:price:amount" content="199"><meta property="product:price:currency" content="czk"><meta property="product:availability" content="in stock"><meta property="og:image" content="/h.jpg"></head></html>'
  const b = P.lookupProduct(og, 'https://s.example/h')
  assert.equal(b.source, 'opengraph')
  assert.equal(b.products[0].currency, 'CZK')
  assert.equal(b.products[0].availability, 'in_stock')

  const both = P.lookupProduct(og.replace('</head>', `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Hrnek' })}</script></head>`), 'https://s.example/h')
  assert.equal(both.source, 'json-ld')
  assert.equal(both.products[0].price, 199)
  assert.equal(both.products[0].availability, 'in_stock')
})

test('a page with no product data is not found (and so not charged)', () => {
  const r = P.lookupProduct('<html><head><title>Blog</title></head><body><h1>Hello</h1><p>text</p></body></html>', 'https://s.example/blog')
  assert.equal(r.found, false)
  assert.equal(r.source, null)
  assert.deepEqual(r.products, [])
})

test('price: a cent a lookup, same balance units as Qbox ($1 = 300)', () => {
  assert.equal(PR.agentToolUsd('product'), 0.01)
  assert.equal(PR.agentToolUnits('product'), 3)
  assert.deepEqual([...PR.PAY_PER_CALL_TOOLS].sort(), ['product', 'scan'])
})

test('x402 offer asks the exact price in USDC base units and carries the discovery hint', () => {
  const cfg = X.x402Config({ QBOX_X402_PAY_TO: '0x' + '1'.repeat(40) })
  const r = X.requirements(cfg, 0.01, 'https://quantecode.com/api/agent/v1/product', 'd', { input: { type: 'http', method: 'GET' } })
  assert.equal(r.maxAmountRequired, '10000')
  assert.equal(r.outputSchema.input.method, 'GET')
  assert.equal(X.requirements(cfg, 0.2, 'r', 'd').maxAmountRequired, '200000')
  assert.equal('outputSchema' in X.requirements(cfg, 5, 'r', 'd'), false)
  assert.equal(X.signedUnits({ payload: { authorization: { value: '10000' } } }), '10000')
  assert.equal(X.signedUnits({ payload: { authorization: { value: '1e4' } } }), null)
})

test('pay-per-call settles only after the work succeeded', () => {
  const src = readFileSync(new URL('lib/agents/pay-per-call.ts', ROOT), 'utf8')
  const verify = src.indexOf('await verifyPayment(')
  const work = src.indexOf('await work()')
  const settle = src.indexOf('await settleVerified(')
  assert.ok(verify > 0 && verify < work && work < settle, 'verify → work → settle')
  assert.match(src, /if \(!result\.ok\) return json\(\{ \.\.\.result\.body, charged: false \}/)
  assert.match(src, /signedUnits\(payment\) !== reqs\.maxAmountRequired/)
})
