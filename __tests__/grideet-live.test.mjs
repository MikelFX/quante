// Dashboard phases 3 + 4 (CLAUDE.md §13h): live numbers per store (lib/grideet/live.ts — paid
// orders and revenue in 30 days, orders to ship, the newest build) and the rule-based next steps
// (brandTips), plus the loader: orders only of the user's own stores on the current page, and a
// missing table never breaks the page.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const FAKES = new URL('./fakes/', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/supabase/admin') return nextResolve(new URL('supabase-admin.mjs', FAKES).href, context)
    if (specifier === '@/lib/hosting/vercel') return nextResolve('data:text/javascript,export const HOSTING_ROOT_DOMAIN = "stores.test"', context)
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const L = await import('../lib/grideet/live.ts')
const M = await import('../lib/grideet/model.ts')
const { __db } = await import('./fakes/supabase-admin.mjs')
const { loadGrideet } = await import('../lib/grideet/load.ts')
const src = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8')

const NOW = Date.parse('2026-10-29T12:00:00Z')
const ago = (days, now = NOW) => new Date(now - days * 86_400_000).toISOString()
const order = (extra) => ({ project_id: 'p1', status: 'paid', payment_status: 'paid', payment_method: 'stripe', total_cents: 1000, currency: 'czk', created_at: ago(1), ...extra })

// ─── Live numbers ───────────────────────────────────────────────────────────────────────────

test('revenue counts paid orders of the last 30 days only, per currency; sandbox and other stores never', () => {
  const s = L.liveStats('p1', [
    order({ total_cents: 2500 }),
    order({ total_cents: 1000, currency: 'eur', status: 'shipped' }),
    order({ total_cents: 9999, created_at: ago(31) }), // too old
    order({ payment_status: 'test_paid', status: 'paid' }), // sandbox
    order({ payment_status: 'pending', status: 'pending', payment_method: 'prevod' }), // no money yet
    order({ project_id: 'p2', total_cents: 7777 }), // another store
  ], [], NOW)
  assert.equal(s.paidOrders, 2)
  assert.deepEqual(s.revenue, [{ currency: 'CZK', cents: 2500 }, { currency: 'EUR', cents: 1000 }])
})

test('orders to ship follow the order lifecycle', () => {
  assert.equal(L.needsShipping({ status: 'paid', payment_status: 'paid', payment_method: 'stripe' }), true)
  assert.equal(L.needsShipping({ status: 'pending', payment_status: 'pending', payment_method: 'dobirka' }), true, 'cash on delivery ships before payment')
  assert.equal(L.needsShipping({ status: 'pending', payment_status: 'pending', payment_method: 'prevod' }), false, 'bank transfer waits for the money')
  assert.equal(L.needsShipping({ status: 'paid', payment_status: 'test_paid', payment_method: 'stripe' }), false, 'sandbox orders are not real')
  for (const status of ['shipped', 'cancelled', 'refunded']) assert.equal(L.needsShipping({ status, payment_status: 'paid' }), false, status)
})

test('the newest build decides: failed, running or nothing', () => {
  const b = (status, d) => ({ project_id: 'p1', status, created_at: ago(d) })
  assert.equal(L.liveStats('p1', [], [b('ready', 2), b('error', 1)], NOW).build, 'failed')
  assert.equal(L.liveStats('p1', [], [b('error', 2), b('ready', 1)], NOW).build, null, 'a later good build clears it')
  assert.equal(L.liveStats('p1', [], [b('building', 0)], NOW).build, 'running')
  assert.equal(L.liveStats('p1', [], [{ ...b('error', 0), project_id: 'p2' }], NOW).build, null)
})

// ─── Next steps ─────────────────────────────────────────────────────────────────────────────

test('next steps come from facts on the card, each leading into an existing flow', () => {
  const products = M.productItems('p1', [{ id: '1', name: 'Mug' }, { id: '2', name: 'Šálek' }], ago(1))
  const qgent = M.qgentItems([{ id: 'q1', project_id: 'p1', title: 'Hero', status: 'proposed', created_at: ago(1) }])
  const live = L.liveStats('p1', [order({})], [{ project_id: 'p1', status: 'error', created_at: ago(0) }], NOW)
  const [g] = M.groupByBrand([{ id: 'p1', name: 'Mine', status: 'ready', updatedAt: ago(1) }], [...products, ...qgent], new Map([['p1', { state: 'changes', live }]]))
  const tips = L.brandTips(g, ['šálek'])
  assert.deepEqual(tips.map((t) => t.id), ['build', 'ship', 'publish', 'qgent', 'ads'])
  assert.equal(tips.find((t) => t.id === 'ship').action.href, '/project/p1?tab=orders')
  assert.equal(tips.find((t) => t.id === 'qgent').action.href, '/project/p1?tab=qgent')
  const ads = tips.find((t) => t.id === 'ads')
  assert.match(ads.text, /“Mug” has no ad yet/, 'Šálek has an ad (accents and case ignored)')
  assert.equal(ads.action.type, 'qadsDraft')
  assert.equal(ads.action.payload.productName, 'Mug')
  for (const t of tips) assert.ok(['link', 'qadsDraft'].includes(t.action.type), 'no tip calls an API or spends credits')

  const [quiet] = M.groupByBrand([{ id: 'p1', name: 'Mine', status: 'ready', updatedAt: ago(1) }], [], new Map([['p1', { state: 'live', live: L.liveStats('p1', [], [], NOW) }]]))
  assert.deepEqual(L.brandTips(quiet, []), [])
  assert.deepEqual(L.brandTips({ ...quiet, id: null }, []), [], 'Unassigned has no store to act on')
})

// ─── Loader ─────────────────────────────────────────────────────────────────────────────────

const U = 'user_me'
const X = 'user_other'
beforeEach(() => {
  __db.reset()
  const now = Date.now()
  __db.tables = {
    projects: [
      { id: 'p1', user_id: U, name: 'Mine', status: 'ready', updated_at: ago(1, now), created_at: ago(9, now) },
      { id: 'px', user_id: X, name: 'Theirs', status: 'ready', updated_at: ago(1, now), created_at: ago(9, now) },
    ],
    store_orders: [
      { id: 'o1', project_id: 'p1', status: 'paid', payment_status: 'paid', payment_method: 'stripe', total_cents: 4200, currency: 'czk', created_at: ago(2, now) },
      { id: 'o2', project_id: 'p1', status: 'pending', payment_status: 'pending', payment_method: 'dobirka', total_cents: 900, currency: 'czk', created_at: ago(60, now) },
      { id: 'ox', project_id: 'px', status: 'paid', payment_status: 'paid', payment_method: 'stripe', total_cents: 99900, currency: 'czk', created_at: ago(1, now) },
    ],
    deployments: [
      { id: 'd1', project_id: 'p1', user_id: U, status: 'error', created_at: ago(0, now) },
      { id: 'dx', project_id: 'px', user_id: X, status: 'error', created_at: ago(0, now) },
    ],
  }
})

test('the loader reads live numbers only for the user’s own stores', async () => {
  const d = await loadGrideet(U, {})
  const mine = d.groups.find((g) => g.id === 'p1')
  assert.equal(mine.meta.live.paidOrders, 1)
  assert.deepEqual(mine.meta.live.revenue, [{ currency: 'CZK', cents: 4200 }], 'the other user’s order never counts')
  assert.equal(mine.meta.live.toShip, 2, 'an old cash-on-delivery order still waiting counts')
  assert.equal(mine.meta.live.build, 'failed')
  assert.deepEqual(mine.meta.tips.map((t) => t.id), ['build', 'ship'])
  assert.ok(!d.groups.some((g) => g.id === 'px'))
})

test('without store_orders or deployments the page still loads', async () => {
  __db.missing.add('store_orders')
  __db.missing.add('deployments')
  const d = await loadGrideet(U, {})
  const mine = d.groups.find((g) => g.id === 'p1')
  assert.equal(mine.meta.live.paidOrders, 0)
  assert.ok(d.skipped.includes('store_orders'))
  assert.equal(d.skipped.filter((s) => s === 'store_orders').length, 1, 'listed once')
})

test('ad performance is not shown: nothing writes qads_metrics yet', () => {
  assert.doesNotMatch(src('lib/grideet/load.ts'), /qads_metrics/)
  assert.doesNotMatch(src('lib/grideet/live.ts'), /from\('qads_metrics'\)/)
  assert.match(src('app/(app)/project/[id]/StudioClient.tsx'), /tab === 'orders'/, 'the orders deep link opens the Studio orders')
})
