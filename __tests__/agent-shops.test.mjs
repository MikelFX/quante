// Agent-ready stores (2026-11-06): the files every generated store carries
// (lib/store-template/agent-shop.ts → /.well-known/agent-shop.json, catalog, quote, order, MCP),
// the platform's store info (lib/agent-shops/store-info.ts) and the registry rules
// (lib/agent-shops/model.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

const A = await import('../lib/store-template/agent-shop.ts')
const B = await import('../lib/store-template/build.ts')
const I = await import('../lib/agent-shops/store-info.ts')
const M = await import('../lib/agent-shops/model.ts')

// The store's pure core, loaded straight from the string the store gets.
const dir = mkdtempSync(join(tmpdir(), 'agent-shop-'))
writeFileSync(join(dir, 'agent-shop.ts'), A.AGENT_SHOP_FILES['lib/agent-shop.ts'])
const S = await import(pathToFileURL(join(dir, 'agent-shop.ts')).href)

const input = (over = {}) => ({
  origin: 'https://kafe.example',
  brand: { name: 'Kafe u Lípy', tagline: 'Výběrová káva', currency: 'CZK', language: 'cs', country: 'CZ' },
  seo: { title: 'Kafe', description: 'Pražírna v Brně.' },
  products: [
    { id: 'p1', name: 'Etiopie Yirgacheffe', description: 'Květinová, citrus.', price: 289, images: ['/img/e.jpg', 'https://cdn.example/x.png'], slug: 'etiopie', available: true, tags: ['káva', 'zrnková'] },
    { id: 'p2', name: 'Kolumbie Huila', description: 'Čokoláda.', price: 259, compareAtPrice: 299, images: [], slug: 'kolumbie', available: true },
    { id: 'p3', name: 'Mlýnek', description: 'Ruční.', price: 990, images: [], slug: 'mlynek', available: false },
    { id: '', name: 'broken', price: 1, slug: 'x' },
  ],
  shipping: { methods: [{ id: 'zasilkovna', label: 'Zásilkovna', price: 79 }, { id: 'ppl', label: 'PPL', price: 119 }], freeShippingFrom: 1000 },
  payments: [{ id: 'stripe', kind: 'online', label: 'Card', fee: 0 }, { id: 'dobirka', kind: 'cash_on_delivery', label: 'Cash on delivery', fee: 39 }],
  stock: { p1: 3 },
  ordering: true,
  ...over,
})

const buyer = { name: 'Jana Nováková', email: 'jana@example.com', address: { street: 'Lipová 1', city: 'Brno', postalCode: '60200', country: 'cz' } }

test('store core: products for agents — absolute URLs, stock, availability, broken rows dropped', () => {
  const list = S.agentProducts(input())
  assert.deepEqual(list.map((p) => p.id), ['p1', 'p2', 'p3'])
  const [e, k, m] = list
  assert.equal(e.url, 'https://kafe.example/products/etiopie')
  assert.deepEqual(e.images, ['https://kafe.example/img/e.jpg', 'https://cdn.example/x.png'])
  assert.equal(e.stock, 3)
  assert.equal(e.currency, 'CZK')
  assert.equal(k.compareAtPrice, 299)
  assert.equal(m.available, false)
  assert.equal(S.agentProducts(input({ stock: { p1: 0 } }))[0].available, false)
})

test('store core: search ignores accents and case, every word must match, name hits first', () => {
  const list = S.agentProducts(input())
  assert.deepEqual(S.searchProducts(list, { q: 'KAVA' }).map((p) => p.id), ['p1'])
  assert.deepEqual(S.searchProducts(list, { q: 'etiopie citrus' }).map((p) => p.id), ['p1'])
  assert.deepEqual(S.searchProducts(list, { q: 'etiopie mlynek' }), [])
  assert.deepEqual(S.searchProducts(list, { q: '', maxPrice: 270 }).map((p) => p.id), ['p2'])
  assert.deepEqual(S.searchProducts(list, { q: '', inStockOnly: true }).map((p) => p.id), ['p1', 'p2'])
  assert.equal(S.findProduct(list, 'kolumbie').id, 'p2')
  assert.equal(S.findProduct(list, 'p1').id, 'p1')
})

test('store core: agent-shop.json describes catalog, shipping, payments, ordering, policies — no platform names', () => {
  const d = S.shopDoc(input())
  assert.equal(d.agentShop, '1.0')
  assert.equal(d.shop.name, 'Kafe u Lípy')
  assert.equal(d.shop.description, 'Pražírna v Brně.')
  assert.equal(d.catalog.products, 3)
  assert.equal(d.catalog.inStock, 2)
  assert.equal(d.catalog.url, 'https://kafe.example/api/agent/products')
  assert.equal(d.shipping.freeShippingFrom, 1000)
  assert.deepEqual(d.payment.methods.map((p) => p.kind), ['online', 'cash_on_delivery'])
  assert.equal(d.ordering.available, true)
  assert.equal(d.ordering.order.url, 'https://kafe.example/api/agent/order')
  assert.equal(d.policies.terms, 'https://kafe.example/terms')
  assert.equal(d.interfaces.mcp, 'https://kafe.example/api/mcp')
  assert.equal(S.shopDoc(input({ ordering: false })).ordering.available, false)
  assert.doesNotMatch(JSON.stringify(d) + S.llmsText(input()), /quante|assetra/i)
  assert.match(S.llmsText(input()), /^# Kafe u Lípy\n/)
})

test('store core: quote prices from the catalog only, with shipping, free-shipping threshold and fee', () => {
  const q = S.quote(input(), { items: [{ id: 'p1', quantity: 2, price: 1 }], shippingMethod: 'ppl', paymentMethod: 'dobirka' })
  assert.equal(q.ok, true)
  assert.equal(q.subtotal, 578)
  assert.deepEqual(q.shipping, { id: 'ppl', label: 'PPL', price: 119 })
  assert.equal(q.paymentFee, 39)
  assert.equal(q.total, 736)
  const free = S.quote(input(), { items: [{ id: 'p1', quantity: 3 }, { id: 'p2', quantity: 1 }] })
  assert.equal(free.shipping.price, 0)
  assert.equal(free.payment.id, 'stripe')
  assert.match(S.quote(input(), { items: [{ id: 'p1', quantity: 4 }] }).error, /Only 3 in stock/)
  assert.match(S.quote(input(), { items: [{ id: 'p3', quantity: 1 }] }).error, /Not available/)
  assert.match(S.quote(input(), { items: [{ id: 'zz', quantity: 1 }] }).error, /Unknown product/)
  assert.match(S.quote(input(), { items: [{ id: 'p1', quantity: 1.5 }] }).error, /whole number/)
  assert.match(S.quote(input(), { items: [{ id: 'p1', quantity: 1 }], shippingMethod: 'dhl' }).error, /Unknown shippingMethod/)
  assert.match(S.quote(input(), { items: [] }).error, /at least one/)
})

test('store core: an order needs consent and a full address, and goes to the store checkout as-is', () => {
  const base = { items: [{ id: 'p1', quantity: 1 }], shippingMethod: 'zasilkovna', paymentMethod: 'stripe', buyer }
  assert.match(S.checkoutBody(input(), base).error, /consent: true/)
  assert.match(S.checkoutBody(input({ ordering: false }), { ...base, consent: true }).error, /not taking orders/)
  assert.match(S.checkoutBody(input(), { ...base, consent: true, buyer: { ...buyer, email: 'nope' } }).error, /email/)
  assert.match(S.checkoutBody(input(), { ...base, consent: true, buyer: { ...buyer, address: { street: 'x', city: 'y', postalCode: '1', country: 'Czechia' } } }).error, /two-letter/)
  const c = S.checkoutBody(input(), { ...base, consent: true })
  assert.equal(c.ok, true)
  assert.deepEqual(c.checkout, {
    items: [{ id: 'p1', quantity: 1 }], paymentMethod: 'stripe', shippingMethod: 'Zásilkovna', shippingCountry: 'CZ',
    customerEmail: 'jana@example.com', customerName: 'Jana Nováková', customerPhone: undefined,
    shippingAddress: { ulice: 'Lipová 1', mesto: 'Brno', psc: '60200', zeme: 'CZ' },
  })
  const paid = S.orderResult(c.quote, 200, { url: 'https://checkout.stripe.com/c/x' })
  assert.equal(paid.status, 'awaiting_payment')
  assert.equal(paid.paymentUrl, 'https://checkout.stripe.com/c/x')
  const cod = S.checkoutBody(input(), { ...base, paymentMethod: 'dobirka', consent: true })
  const placed = S.orderResult(cod.quote, 200, { url: 'https://kafe.example/success?order=A1' })
  assert.equal(placed.status, 'placed')
  assert.equal(placed.confirmationUrl, 'https://kafe.example/success?order=A1')
  assert.deepEqual(S.orderResult(c.quote, 429, { error: 'Too many' }), { ok: false, status: 429, error: 'Too many' })
})

test('store MCP: tools, place_order only when ordering, notifications get no answer', async () => {
  let placed = null
  const place = async (a) => { placed = a; return { ok: true, status: 'placed' } }
  const rpc = (m, inp = input()) => S.handleShopRpc(inp, { jsonrpc: '2.0', id: 1, ...m }, place)
  const init = await rpc({ method: 'initialize', params: { protocolVersion: '2025-03-26' } })
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.equal(init.result.serverInfo.title, 'Kafe u Lípy')
  const names = (await rpc({ method: 'tools/list' })).result.tools.map((t) => t.name)
  assert.deepEqual(names, ['get_shop', 'search_products', 'get_product', 'quote_order', 'place_order'])
  assert.deepEqual((await rpc({ method: 'tools/list' }, input({ ordering: false }))).result.tools.map((t) => t.name), ['get_shop', 'search_products', 'get_product'])
  const hits = await rpc({ method: 'tools/call', params: { name: 'search_products', arguments: { query: 'kolumbie' } } })
  assert.equal(hits.result.structuredContent.items[0].id, 'p2')
  await rpc({ method: 'tools/call', params: { name: 'place_order', arguments: { consent: true } } })
  assert.deepEqual(placed, { consent: true })
  assert.equal((await rpc({ method: 'tools/call', params: { name: 'place_order', arguments: {} } }, input({ ordering: false }))).error.code, -32602)
  assert.equal(await S.handleShopRpc(input(), { jsonrpc: '2.0', method: 'notifications/initialized' }, place), null)
})

test('scaffold: every store carries the agent files, locked, at their well-known addresses', () => {
  const files = new Map(B.buildStoreFiles({ 'data/products.ts': 'export const products = []\n' }).map((f) => [f.path, f.content]))
  for (const p of Object.keys(A.AGENT_SHOP_FILES)) {
    assert.ok(files.has(p), p)
    assert.ok(B.PLATFORM_LOCKED_FILES.has(p), `${p} locked`)
    assert.doesNotMatch(A.AGENT_SHOP_FILES[p], /quantecode|assetra|Quante(?!_| hosted)/, `${p} white-label`)
  }
  // an AI copy can never replace them
  const ai = new Map(B.buildStoreFiles({ 'lib/agent-shop.ts': 'export const x = 1\n' }).map((f) => [f.path, f.content]))
  assert.equal(ai.get('lib/agent-shop.ts'), A.AGENT_SHOP_FILES['lib/agent-shop.ts'])
  assert.equal(B.isAllowedStorePath('app/api/agent/order/route.ts'), false)
  const cfg = files.get('next.config.ts')
  assert.match(cfg, /"source":"\/\.well-known\/agent-shop\.json","destination":"\/api\/agent\/shop"/)
  assert.match(cfg, /"source":"\/llms\.txt","destination":"\/api\/agent\/llms"/)
  assert.match(cfg, /key: 'Link'/)
  assert.ok(B.SCAFFOLD_VERSION >= 6)
  for (const src of Object.values(A.AGENT_SHOP_FILES)) assert.doesNotMatch(src, /\$\{/)
})

test('platform store info: payment ids the checkout knows, fees in major units, stock capped, ordering only when live', () => {
  const p = {
    currency: 'CZK', shippingMethods: [{ id: 's1', label: 'PPL', cents: 11900 }], freeShippingFromCents: 150000,
    cod: { enabled: true, feeCents: 3900 }, bankTransferEnabled: true, onlineMethods: new Set(['comgate', 'stripe']),
  }
  const info = I.storeAgentInfo(p, [{ product_id: 'p1', variant_id: null, stock_qty: 5 }, { product_id: 'p2', variant_id: 'v1', stock_qty: 5000 }], true)
  assert.deepEqual(info.payments.map((x) => [x.id, x.kind, x.fee]), [['stripe', 'online', 0], ['comgate', 'online', 0], ['prevod', 'bank_transfer', 0], ['dobirka', 'cash_on_delivery', 39]])
  assert.deepEqual(info.shipping, { methods: [{ id: 's1', label: 'PPL', price: 119 }], freeShippingFrom: 1500 })
  assert.deepEqual(info.stock, { p1: 5, 'p2::v1': 999 })
  assert.equal(info.ordering, true)
  assert.equal(I.storeAgentInfo(p, [], false).ordering, false)
  assert.equal(I.storeAgentInfo({ ...p, cod: { enabled: false, feeCents: 0 }, bankTransferEnabled: false, onlineMethods: new Set() }, [], true).ordering, false)
})

test('registry: reads a store document only from its own origin', () => {
  const origin = 'https://kafe.example'
  const doc = S.shopDoc(input())
  const r = M.parseShopDoc(doc, origin)
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'Kafe u Lípy')
  assert.equal(r.value.country, 'CZ')
  assert.equal(r.value.ordering, true)
  assert.deepEqual(r.value.paymentKinds, ['online', 'cash_on_delivery'])
  assert.equal(r.value.mcp, 'https://kafe.example/api/mcp')
  assert.match(M.parseShopDoc({ ...doc, catalog: { url: 'https://evil.example/p' } }, origin).error, /own address/)
  assert.match(M.parseShopDoc({ ...doc, agentShop: '2.0' }, origin).error, /Not an agent-shop/)
  assert.match(M.parseShopDoc({ ...doc, shop: { ...doc.shop, currency: 'koruna' } }, origin).error, /currency/)
  assert.equal(M.shopOrigin('kafe.example/x?y'), 'https://kafe.example')
  assert.equal(M.shopOrigin('http://kafe.example'), null)
  assert.equal(M.shopOrigin('https://u:p@kafe.example'), null)
})

test('registry: products — same-origin URLs only, folded search text, one row per id', () => {
  const doc = M.parseShopDoc(S.shopDoc(input()), 'https://kafe.example').value
  const list = S.agentProducts(input())
  const rows = M.parseProducts({ products: [...list, { ...list[0] }, { ...list[1], id: 'x', url: 'https://evil.example/p' }] }, doc)
  assert.deepEqual(rows.map((r) => r.productId), ['p1', 'p2', 'p3'])
  assert.equal(rows[0].image, 'https://kafe.example/img/e.jpg')
  assert.equal(rows[0].stock, 3)
  assert.equal(rows[2].available, false)
  assert.match(rows[0].searchText, /etiopie yirgacheffe .*kava zrnkova/)
  assert.doesNotMatch(rows[0].searchText, /[A-ZÁ-Ž]/)
})

test('registry: search input becomes a safe prefix tsquery', () => {
  assert.equal(M.tsQuery('Zrnková KÁVA!'), 'zrnkova:* & kava:*')
  assert.equal(M.tsQuery("a' | ! & (x)"), null)
  assert.equal(M.tsQuery('etiopie):* | drop'), 'etiopie:* & drop:*')
  const s = M.parseSearch({ q: 'káva', country: 'cz', maxPrice: '300', inStock: '1', limit: '500' })
  assert.deepEqual(s.value, { q: 'káva', tsquery: 'kava:*', country: 'CZ', currency: null, maxPrice: 300, inStock: true, limit: 50 })
  assert.equal(M.parseSearch({ query: 'x' }).ok, false)
  assert.equal(M.parseSearch({ query: 'mlýnek' }).value.tsquery, 'mlynek:*')
})

test('registry: a removed store stays removed; three failures in a row hide it, one success brings it back', () => {
  assert.equal(M.nextStatus('listed', false, 1), 'listed')
  assert.equal(M.nextStatus('listed', false, M.UNREACHABLE_AFTER), 'unreachable')
  assert.equal(M.nextStatus('unreachable', true, 0), 'listed')
  assert.equal(M.nextStatus('removed', true, 0), 'removed')
  const hit = M.searchHit({ shop_id: 's', shop_name: 'Kafe', shop_origin: 'https://kafe.example', shop_country: 'CZ', shop_ordering: true, product_id: 'p1', product_name: 'E', product_description: null, product_url: 'https://kafe.example/products/e', product_image: null, price: '289.00', compare_at: null, currency: 'CZK', available: true, stock: 3, rank: 0.1 })
  assert.equal(hit.product.price, 289)
  assert.equal(hit.shop.agentShop, 'https://kafe.example/.well-known/agent-shop.json')
})
