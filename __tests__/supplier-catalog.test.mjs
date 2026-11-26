// Supplier catalog (CLAUDE.md §13r): feeds → catalog rows, prices, store products, which orders go
// to which supplier, the supplier's tracking form and the admin's supplier settings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const F = await import('../lib/suppliers/feed.ts')
const M = await import('../lib/suppliers/model.ts')

const HEUREKA = `<?xml version="1.0" encoding="utf-8"?>
<SHOP>
  <SHOPITEM>
    <ITEM_ID>A-100</ITEM_ID>
    <PRODUCTNAME><![CDATA[Pleťový krém <b>Růže</b> 50 ml]]></PRODUCTNAME>
    <DESCRIPTION><![CDATA[<p>Hydratační krém &amp; sérum.</p><script>alert(1)</script>]]></DESCRIPTION>
    <URL>https://dodavatel.cz/krem-ruze</URL>
    <IMGURL>https://dodavatel.cz/img/a.jpg</IMGURL>
    <IMGURL_ALTERNATIVE>https://dodavatel.cz/img/b.jpg</IMGURL_ALTERNATIVE>
    <IMGURL_ALTERNATIVE>javascript:alert(1)</IMGURL_ALTERNATIVE>
    <PRICE_VAT>349</PRICE_VAT>
    <NAKUPNI_CENA>180,50</NAKUPNI_CENA>
    <MANUFACTURER>Bylinka</MANUFACTURER>
    <CATEGORYTEXT>Kosmetika | Pleť | Krémy</CATEGORYTEXT>
    <EAN>8590000000017</EAN>
    <DELIVERY_DATE>0</DELIVERY_DATE>
    <STOCK><AMOUNT>12</AMOUNT></STOCK>
    <DELIVERY><DELIVERY_ID>PPL</DELIVERY_ID><DELIVERY_PRICE>89</DELIVERY_PRICE></DELIVERY>
  </SHOPITEM>
  <SHOPITEM>
    <ITEM_ID>A-101</ITEM_ID>
    <PRODUCTNAME>Šampon</PRODUCTNAME>
    <PRICE_VAT>199 Kč</PRICE_VAT>
    <DELIVERY_DATE>vyprodáno</DELIVERY_DATE>
  </SHOPITEM>
</SHOP>`

const GOOGLE = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>
<item><g:id>G1</g:id><g:title>Hrnek smalt</g:title><g:description>Smaltovaný hrnek</g:description>
<g:link>https://brand.cz/hrnek</g:link><g:image_link>https://brand.cz/h.jpg</g:image_link>
<g:price>12.50 EUR</g:price><g:brand>Smalt&amp;Co</g:brand><g:availability>in stock</g:availability>
<g:product_type>Domov &gt; Kuchyně &gt; Hrnky</g:product_type><g:gtin>4006381333931</g:gtin></item>
<item><g:id>G2</g:id><g:title>Konvice</g:title><g:price>40 EUR</g:price><g:availability>out of stock</g:availability></item>
</channel></rss>`

const CSV = `﻿id;nazev;cena;nakupni_cena;znacka;kategorie;obrazek;skladem
X1;"Tričko ""Logo""";499;220;Vlastní;Móda;https://x.cz/1.jpg;5
X2;Mikina;899;;Vlastní;Móda;ftp://x.cz/2.jpg;0
`

test('heureka feed: text cleaned, images filtered, wholesale tag, nested stock', () => {
  assert.equal(F.detectFormat(HEUREKA), 'heureka')
  const [a, b] = F.parseFeed(HEUREKA, 'auto')
  assert.equal(a.externalId, 'A-100')
  assert.equal(a.name, 'Pleťový krém Růže 50 ml')
  assert.ok(!a.description.includes('<'), 'no markup survives')
  assert.ok(a.description.startsWith('Hydratační krém & sérum.'))
  assert.deepEqual(a.images, ['https://dodavatel.cz/img/a.jpg', 'https://dodavatel.cz/img/b.jpg'])
  assert.equal(a.retailPrice, 349)
  assert.equal(a.wholesalePrice, 180.5)
  assert.equal(a.brand, 'Bylinka')
  assert.equal(a.stock, 12)
  assert.equal(a.deliveryDays, 0)
  assert.equal(a.available, true)
  assert.equal(a.ean, '8590000000017')
  assert.equal(b.available, false, 'vyprodáno = unavailable')
  assert.equal(b.retailPrice, 199)
  assert.equal(b.currency, 'CZK')
})

test('google feed: g: fields, availability, category path', () => {
  assert.equal(F.detectFormat(GOOGLE), 'google')
  const [a, b] = F.parseFeed(GOOGLE, 'auto')
  assert.equal(a.externalId, 'G1')
  assert.equal(a.retailPrice, 12.5)
  assert.equal(a.currency, 'EUR')
  assert.equal(a.brand, 'Smalt&Co')
  assert.equal(a.category, 'Domov | Kuchyně | Hrnky')
  assert.equal(a.available, true)
  assert.equal(b.available, false)
})

test('csv feed: separator, quotes, BOM, columns by Czech names', () => {
  const rows = F.parseFeed(CSV, 'auto')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'Tričko "Logo"')
  assert.equal(rows[0].wholesalePrice, 220)
  assert.equal(rows[0].stock, 5)
  assert.deepEqual(rows[1].images, [], 'only http(s) images')
  assert.equal(rows[1].available, false)
})

test('a supplier-specific wholesale field wins', () => {
  const xml = '<SHOP><SHOPITEM><ITEM_ID>1</ITEM_ID><PRODUCTNAME>P</PRODUCTNAME><PRICE_VAT>100</PRICE_VAT><MOJE_CENA>55</MOJE_CENA><VOC>70</VOC></SHOPITEM></SHOP>'
  assert.equal(F.parseFeed(xml, 'heureka', { wholesaleField: 'MOJE_CENA' })[0].wholesalePrice, 55)
  assert.equal(F.parseFeed(xml, 'heureka')[0].wholesalePrice, 70)
})

test('feed size is capped', () => {
  const many = '<SHOP>' + '<SHOPITEM><ITEM_ID>1</ITEM_ID></SHOPITEM>'.repeat(30) + '</SHOP>'
  assert.equal(F.parseFeed(many, 'heureka', { limit: 10 }).length, 10)
})

const SUP = { currency: 'CZK', wholesale_discount_pct: null, dispatch_days: 2 }

test('catalog rows: wholesale required, discount fallback, never retail below wholesale', () => {
  const [a, b] = F.parseFeed(HEUREKA, 'heureka')
  const row = M.normalizeItem(a, SUP)
  assert.equal(row.wholesale_cents, 18050)
  assert.equal(row.retail_cents, 34900)
  assert.equal(row.currency, 'CZK')
  assert.equal(row.dispatch_days, 0)
  assert.ok(row.search_text.includes('pletovy krem ruze'))
  assert.equal(M.normalizeItem(b, SUP), null, 'no wholesale price and no agreed discount')
  const withDiscount = M.normalizeItem(b, { ...SUP, wholesale_discount_pct: 30 })
  assert.equal(withDiscount.wholesale_cents, 13930)
  assert.equal(withDiscount.available, false)
  const bad = M.normalizeItem({ ...a, retailPrice: 100 }, SUP)
  assert.equal(bad.retail_cents, null, 'a retail price under wholesale is not suggested')
  assert.equal(M.normalizeItem({ ...a, externalId: '', sku: '', ean: '' }, SUP), null)
})

test('search words are folded and bounded', () => {
  assert.deepEqual(M.searchWords('  Pleťový KRÉM, růže!! a '), ['pletovy', 'krem', 'ruze'])
  assert.deepEqual(M.searchWords("x'; drop table--"), ['drop', 'table'])
  assert.equal(M.searchWords('a b c d e f g h i j k l m n o p q r s t'.split(' ').map((w) => w + w).join(' ')).length, 6)
  assert.deepEqual(M.searchWords(null), [])
})

test('prices: suggested, nice endings, margin, merchant price limits', () => {
  assert.equal(M.nicePrice(287.2, 'CZK'), 289)
  assert.equal(M.nicePrice(290, 'CZK'), 299)
  assert.equal(M.nicePrice(12.1, 'EUR'), 12.99)
  assert.equal(M.suggestedPrice({ wholesale_cents: 18050, retail_cents: 34900, currency: 'CZK' }), 349)
  assert.equal(M.suggestedPrice({ wholesale_cents: 18050, retail_cents: null, currency: 'CZK' }), 289)
  assert.deepEqual(M.margin(349, 18050), { amount: 168.5, share: 16850 / 34900 })
  assert.equal(M.checkRetailPrice('349', 18050).ok, true)
  assert.equal(M.checkRetailPrice('349,90', 18050).price, 349.9)
  assert.equal(M.checkRetailPrice(150, 18050).ok, false, 'below wholesale')
  assert.equal(M.checkRetailPrice(5000, 18050).ok, false, 'over 10×')
  assert.equal(M.checkRetailPrice('abc', 18050).ok, false)
  assert.equal(M.sameCurrency('czk', 'CZK'), true)
  assert.equal(M.sameCurrency('EUR', 'CZK'), false)
  assert.equal(M.sameCurrency(null, 'CZK'), false)
})

test('store product: our images only, stable id, unique slug', () => {
  const row = { id: '7f3a9c1e-1111-2222-3333-444455556666', name: 'Pleťový krém Růže', description: 'd', brand: 'Bylinka', category: 'Kosmetika | Pleť | Krémy', ean: '859', sku: '', available: true }
  const p = M.toStoreProduct(row, 349, ['https://x.supabase.co/storage/v1/object/public/store-assets/u/p/1.jpg'], [{ id: 'a', slug: 'pletovy-krem-ruze' }])
  assert.equal(p.id, 'sup-7f3a9c1e1111')
  assert.equal(p.id, M.catalogProductId(row.id))
  assert.equal(p.slug, 'pletovy-krem-ruze-2')
  assert.equal(p.price, 349)
  assert.equal(p.sku, '859')
  assert.deepEqual(p.tags, ['Bylinka', 'Krémy'])
})

const LINKS = [
  { product_id: 'sup-a', supplier_id: 'S1', supplier_product_id: 'p1', external_id: 'A-100', name: 'Krém', ean: '', sku: '', wholesale_cents: 18050 },
  { product_id: 'sup-b', supplier_id: 'S2', supplier_product_id: 'p2', external_id: 'B-1', name: 'Hrnek', ean: '', sku: '', wholesale_cents: 9000 },
]

test('orders: split by supplier, own goods stay with the merchant', () => {
  const items = [
    { id: 'sup-a', name: 'Krém', price: 349, quantity: 1 },
    { id: 'own', name: 'Vlastní', price: 100, quantity: 1 },
    { id: 'sup-a', name: 'Krém', price: 349, quantity: 2 },
    { id: 'sup-b', name: 'Hrnek', price: 199, quantity: 1 },
    { id: 'sup-b', quantity: -3 },
  ]
  const split = M.splitBySupplier(items, LINKS)
  assert.deepEqual([...split.keys()].sort(), ['S1', 'S2'])
  assert.equal(split.get('S1')[0].quantity, 3)
  assert.equal(split.get('S1')[0].wholesaleCents, 18050)
  assert.equal(split.get('S2').length, 1)
  assert.equal(M.coversWholeOrder(items, LINKS), false)
  assert.equal(M.coversWholeOrder(items.filter((i) => i.id !== 'own'), LINKS), true)
  assert.equal(M.splitBySupplier('nope', LINKS).size, 0)
})

test('only paid, not yet shipped orders are sent; cash on delivery never automatically', () => {
  assert.equal(M.shouldDispatch({ status: 'paid', payment_status: 'paid', payment_method: 'stripe' }), true)
  assert.equal(M.shouldDispatch({ status: 'paid', payment_status: 'paid', payment_method: 'prevod' }), true)
  assert.equal(M.shouldDispatch({ status: 'pending', payment_status: 'pending', payment_method: 'stripe' }), false)
  assert.equal(M.shouldDispatch({ status: 'pending', payment_status: 'pending', payment_method: 'dobirka' }), false)
  assert.equal(M.shouldDispatch({ status: 'paid', payment_status: 'paid', payment_method: 'dobirka' }), false)
  assert.equal(M.shouldDispatch({ status: 'shipped', payment_status: 'paid', payment_method: 'stripe' }), false)
  assert.equal(M.shouldDispatch({ status: 'cancelled', payment_status: 'paid', payment_method: 'stripe' }), false)
})

test('price moves over 5 % are flagged', () => {
  assert.equal(M.priceMoved(10000, 10400), false)
  assert.equal(M.priceMoved(10000, 10600), true)
  assert.equal(M.priceMoved(10000, 9000), true)
  assert.equal(M.priceMoved(null, 9000), false)
})

test('supplier tracking form', () => {
  assert.deepEqual(M.parseTrackingInput({ trackingCode: ' Z123456789 ', carrier: 'PPL', trackingUrl: 'https://ppl.cz/t?x=1' }),
    { ok: true, action: 'shipped', trackingCode: 'Z123456789', trackingUrl: 'https://ppl.cz/t?x=1', carrier: 'PPL' })
  assert.equal(M.parseTrackingInput({ trackingCode: '12' }).ok, false)
  assert.equal(M.parseTrackingInput({ trackingCode: 'Z1234567', trackingUrl: 'javascript:alert(1)' }).ok, false)
  assert.equal(M.parseTrackingInput({ trackingCode: 'Z1234567', trackingUrl: 'http://x.cz' }).ok, false)
  assert.equal(M.parseTrackingInput({ trackingCode: '<script>' }).ok, false)
  assert.deepEqual(M.parseTrackingInput({ action: 'cannot', reason: 'Vyprodáno' }), { ok: true, action: 'cannot', reason: 'Vyprodáno' })
  assert.equal(M.parseTrackingInput({ action: 'cannot', reason: '' }).ok, false)
})

test('admin supplier settings', () => {
  const ok = M.parseSupplierInput({ name: 'Bylinka s.r.o.', feedUrl: 'https://bylinka.cz/feed.xml?key=1', orderEmail: 'Objednavky@Bylinka.cz', wholesaleDiscountPct: '30', shipsTo: 'cz, sk' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.slug, 'bylinka-s-r-o')
  assert.equal(ok.value.order_email, 'objednavky@bylinka.cz')
  assert.equal(ok.value.wholesale_discount_pct, 30)
  assert.deepEqual(ok.value.ships_to, ['CZ', 'SK'])
  assert.equal(M.parseSupplierInput({ name: 'X', feedUrl: 'https://a.cz', orderEmail: 'a@b.cz' }).ok, false)
  assert.equal(M.parseSupplierInput({ name: 'Xy', feedUrl: 'file:///etc/passwd', orderEmail: 'a@b.cz' }).ok, false)
  assert.equal(M.parseSupplierInput({ name: 'Xy', feedUrl: 'https://u:p@a.cz/f', orderEmail: 'a@b.cz' }).ok, false)
  assert.equal(M.parseSupplierInput({ name: 'Xy', feedUrl: 'https://a.cz/f', orderEmail: 'a@b.cz, c@d.cz' }).ok, false)
  assert.equal(M.parseSupplierInput({ name: 'Xy', feedUrl: 'https://a.cz/f', orderEmail: 'a@b.cz', wholesaleField: 'a b' }).ok, false)
})

test('supplier e-mail: everything escaped, link https only, totals in wholesale prices', async () => {
  const { supplierOrderEmail } = await import('../lib/suppliers/email.ts')
  const mail = supplierOrderEmail({
    supplierName: 'Bylinka', storeName: 'Krásná <script>', orderNumber: '2026-0007', orderDate: '25. 11. 2026',
    confirmUrl: 'https://quantecode.com/supplier-order/abc?t=xyz',
    merchant: { name: 'Jana Nováková', ico: '12345678', dic: '', address: 'Hlavní 1, 110 00 Praha', email: 'jana@example.cz', phone: '' },
    shipTo: { name: 'Petr "<b>"', street: 'Dlouhá 5', city: 'Brno', postalCode: '602 00', country: 'CZ', phone: '+420 600 000 000', email: 'petr@example.cz', pickupPoint: null, shippingMethod: 'PPL' },
    lines: [{ externalId: 'A-100', ean: '859', name: 'Krém <img src=x onerror=alert(1)>', quantity: 2, wholesaleCents: 18050 }],
    currency: 'CZK',
  })
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(!mail.html.includes('<img src=x'))
  assert.ok(mail.html.includes('Krém &lt;img'))
  assert.ok(mail.html.includes('361 Kč'), 'total = 2 × 180,50')
  assert.ok(mail.html.includes('href="https://quantecode.com/supplier-order/abc?t=xyz"'))
  assert.ok(mail.subject.includes('2026-0007'))
  const bad = supplierOrderEmail({ ...{ supplierName: 'S', storeName: 'S', orderNumber: '1', orderDate: 'd', merchant: null, lines: [], currency: 'EUR' }, confirmUrl: 'javascript:alert(1)', shipTo: { name: '', street: '', city: '', postalCode: '', country: 'CZ', phone: '', email: '', pickupPoint: null, shippingMethod: null } })
  assert.ok(!bad.html.includes('javascript:'))
})

test('wiring: every way an order becomes paid hands it to the suppliers; crons and app paths registered', () => {
  for (const f of [
    'app/api/stripe/webhook/route.ts',
    'app/api/payments/gopay/notify/route.ts',
    'app/api/payments/comgate/notify/route.ts',
    'lib/payments/paypal-capture.ts',
    'app/api/store/orders/[orderId]/route.ts',
  ]) assert.match(readFileSync(ROOT + f, 'utf8'), /dispatchSupplierOrdersSafe\(/, f)
  const vercel = readFileSync(ROOT + 'vercel.json', 'utf8')
  assert.ok(vercel.includes('/api/cron/suppliers') && vercel.includes('/api/cron/supplier-orders'))
  assert.ok(readFileSync(ROOT + 'lib/domains.ts', 'utf8').includes("'/supplier-order/:path*'"))
  const dispatch = readFileSync(ROOT + 'lib/suppliers/dispatch.ts', 'utf8')
  // The row is inserted before the e-mail goes out (exactly once per order × supplier).
  assert.ok(dispatch.indexOf(".insert({ order_id") < dispatch.indexOf('await sendToSupplier(o,'))
  const sql = readFileSync(ROOT + 'supabase/migration-supplier-catalog.sql', 'utf8')
  assert.match(sql, /UNIQUE \(order_id, supplier_id\)/)
  for (const t of ['suppliers', 'supplier_products', 'store_supplier_links', 'supplier_orders']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), t)
  }
  assert.ok(!/CREATE POLICY/i.test(sql), 'service role only')
})

// ── demo supplier + catalog filters (lib/suppliers/demo.ts) ─────────────────────
const D = await import('../lib/suppliers/demo.ts')

test('demo feed: every product imports through the normal Heureka parser with wholesale price and stock', () => {
  const items = F.parseFeed(D.demoFeedXml('https://quantecode.com/'), 'auto')
  assert.equal(items.length, D.DEMO_PRODUCTS.length)
  for (const [i, it] of items.entries()) {
    const p = D.DEMO_PRODUCTS[i]
    assert.equal(it.externalId, `demo-${p.key}`)
    assert.equal(it.wholesalePrice, p.wholesale)
    assert.equal(it.retailPrice, p.retail)
    assert.equal(it.currency, 'CZK')
    assert.equal(it.stock, p.stock)
    assert.equal(it.available, true)
    assert.deepEqual(it.images, [`https://quantecode.com/catalog-demo/${p.key}.jpg`])
    assert.ok(p.wholesale < p.retail && p.retail <= p.wholesale * 10, p.key)
  }
  assert.equal(new Set(D.DEMO_PRODUCTS.map((p) => p.key)).size, D.DEMO_PRODUCTS.length)
})

test('demo feed: every photo exists in public/catalog-demo', () => {
  for (const p of D.DEMO_PRODUCTS) assert.ok(readFileSync(`${ROOT}public/catalog-demo/${p.key}.jpg`).length > 10_000, p.key)
})

test('demo supplier: valid settings, slug demo, orders to the given admin address', () => {
  const r = M.parseSupplierInput(D.demoSupplierInput('https://quantecode.com', 'admin@example.com'))
  assert.equal(r.ok, true)
  assert.equal(r.value.slug, D.DEMO_SLUG)
  assert.equal(r.value.order_email, 'admin@example.com')
  assert.equal(r.value.feed_url, 'https://quantecode.com/api/catalog/demo-feed')
  assert.equal(r.value.currency, 'CZK')
})

test('catalog filters: facets, category prefix pattern, sort', () => {
  const f = D.facetsOf([
    { brand: 'Lumo', category: 'Domácnost | Dekorace' }, { brand: 'Lumo', category: 'Domácnost > Svíčky' },
    { brand: 'Pura', category: 'Kosmetika | Pleť' }, { brand: '', category: '' },
  ])
  assert.deepEqual(f.categories, [{ name: 'Domácnost', count: 2 }, { name: 'Kosmetika', count: 1 }])
  assert.deepEqual(f.brands, [{ name: 'Lumo', count: 2 }, { name: 'Pura', count: 1 }])
  assert.equal(D.categoryPrefixPattern('Dům_a%zahrada'), 'Dům\\_a\\%zahrada%')
  assert.equal(D.parseSort('price-asc'), 'price-asc')
  assert.equal(D.parseSort('drop table'), 'relevance')
})

test('demo supplier is admin-only in every catalog read', () => {
  const src = readFileSync(`${ROOT}lib/suppliers/catalog.ts`, 'utf8')
  assert.match(src, /if \(!query\.includeDemo\) req = req\.neq\('suppliers\.slug', DEMO_SLUG\)/)
  assert.match(src, /if \(!query\.includeDemo\) supReq = supReq\.neq\('slug', DEMO_SLUG\)/)
  assert.match(src, /if \(!opts\.includeDemo\) req = req\.neq\('suppliers\.slug', DEMO_SLUG\)/)
  assert.match(src, /suppliers\?\.slug === DEMO_SLUG && !includeDemo\) return null/)
  assert.match(src, /row\.suppliers\.slug === DEMO_SLUG && !includeDemo/)
  for (const f of ['app/api/catalog/route.ts', 'app/api/catalog/[id]/route.ts', 'app/api/projects/[id]/catalog/route.ts']) {
    assert.match(readFileSync(`${ROOT}${f}`, 'utf8'), /requireAdmin\(\)/, f)
  }
})
