// Grideet (CLAUDE.md §13h): the pure model (lib/grideet/model.ts) — grouping by brand, the
// Unassigned group, ordering, filters, paging — and the loader (lib/grideet/load.ts) against an
// in-memory database: only the signed-in user's rows, private media only as short-lived signed
// URLs (never the uploaded product photos), and a missing table / column never breaks the page.
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
    // The hosting client pulls in the whole store template; Grideet only needs the root domain.
    if (specifier === '@/lib/hosting/vercel') return nextResolve('data:text/javascript,export const HOSTING_ROOT_DOMAIN = "stores.test"', context)
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const M = await import('../lib/grideet/model.ts')
const { __db } = await import('./fakes/supabase-admin.mjs')
const { loadGrideet, MEDIA_URL_TTL_S } = await import('../lib/grideet/load.ts')
const src = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8')

const brand = (id, name, updatedAt, status = 'ready') => ({ id, name, status, updatedAt })
const item = (id, brandId, updatedAt, extra = {}) => ({
  id, brandId, module: 'qads', kind: 'video', title: id, status: 'done', statusLabel: 'Ready', updatedAt,
  href: '/x', primaryAction: { label: 'Open', type: 'link', href: '/x' }, actions: [], ...extra,
})

// ─── Model ──────────────────────────────────────────────────────────────────────────────────

test('items are grouped by brand; work without a store goes to Unassigned', () => {
  const groups = M.groupByBrand(
    [brand('a', 'Alpha', '2026-10-01T00:00:00Z'), brand('b', 'Beta', '2026-10-02T00:00:00Z')],
    [item('v1', 'a', '2026-10-03T00:00:00Z'), item('v2', null, '2026-09-01T00:00:00Z'), item('v3', 'gone', '2026-09-02T00:00:00Z')],
  )
  assert.deepEqual(groups.map((g) => g.id), ['a', 'b', null])
  const unassigned = groups.find((g) => g.id === null)
  assert.equal(unassigned.name, M.UNASSIGNED_NAME)
  assert.deepEqual(unassigned.items.map((i) => i.id), ['v3', 'v2'], 'newest first inside a brand')
  assert.ok(unassigned.items.every((i) => i.brandId === null), 'an item of an unknown / archived project is not shown under it')
  assert.equal(groups[0].counts.video, 1)
})

test('no Unassigned group when everything has a brand; brands sort by last activity', () => {
  const groups = M.groupByBrand(
    [brand('a', 'Alpha', '2026-10-05T00:00:00Z'), brand('b', 'Beta', '2026-10-01T00:00:00Z')],
    [item('v1', 'b', '2026-10-09T00:00:00Z')],
  )
  assert.deepEqual(groups.map((g) => g.id), ['b', 'a'], 'Beta had the newest activity (its video)')
  assert.equal(groups[1].items.length, 0, 'a store with nothing in it still shows')
})

test('filters: module / type / status / text', () => {
  const meta = new Map([['a', { state: 'live' }], ['b', { state: 'draft' }]])
  const groups = M.groupByBrand(
    [brand('a', 'Alpha Shop', '2026-10-01T00:00:00Z'), brand('b', 'Beta', '2026-10-02T00:00:00Z')],
    [
      item('v1', 'a', '2026-10-03T00:00:00Z', { title: 'Summer video' }),
      item('s1', null, '2026-10-04T00:00:00Z', { module: 'qscan', kind: 'scan', title: 'oldshop.cz' }),
      item('e1', 'b', '2026-10-05T00:00:00Z', { module: 'qgent', kind: 'edit', status: 'open', title: 'Fix CTA' }),
    ],
    meta,
  )
  assert.deepEqual(M.applyFilters(groups, { module: 'qscan' }).map((g) => g.id), [null])
  assert.deepEqual(M.applyFilters(groups, { kind: 'store' }).map((g) => g.id).sort(), ['a', 'b'], 'stores only, no Unassigned')
  assert.deepEqual(M.applyFilters(groups, { status: 'live' }).map((g) => g.id), ['a'])
  assert.deepEqual(M.applyFilters(groups, { status: 'open' }).map((g) => g.id), ['b'])
  const byName = M.applyFilters(groups, { q: 'alpha' })
  assert.deepEqual(byName.map((g) => g.id), ['a'])
  assert.equal(byName[0].items.length, 1, 'a matching brand keeps its items')
  const byItem = M.applyFilters(groups, { q: 'FIX cta' })
  assert.deepEqual(byItem.map((g) => [g.id, g.items.map((i) => i.id)]), [['b', ['e1']]])
  assert.deepEqual(M.applyFilters(groups, { q: 'nothing like this' }), [])
})

test('paging clamps and the URL filters are whitelisted', () => {
  const list = Array.from({ length: 50 }, (_, i) => i)
  assert.deepEqual(M.paginate(list, 3, 24).items, [48, 49])
  assert.equal(M.paginate(list, 99, 24).page, 3)
  assert.equal(M.paginate([], 1).pages, 1)
  assert.deepEqual(M.parseFilters({ module: 'qads', kind: 'evil', status: 'live', q: ['x'], page: '2' }),
    { q: 'x', module: 'qads', kind: 'all', status: 'live', page: 2 })
})

test('store state: live, draft, unpublished changes', () => {
  assert.equal(M.storeState('ready', null, 'v2'), 'draft')
  assert.equal(M.storeState('ready', { codeVersionId: 'v2' }, 'v2'), 'live')
  assert.equal(M.storeState('ready', { codeVersionId: 'v1' }, 'v2'), 'changes')
  assert.equal(M.storeState('ready', { codeVersionId: null }, null), 'live', 'a manifest store')
  assert.equal(M.storeState('generating', null, null), 'generating')
})

test('actions only lead into existing flows; nothing here spends credits', () => {
  const [p] = M.productItems('p1', [{ id: '7', name: 'Mug', description: 'Big mug', image: null }], '2026-10-01T00:00:00Z', 'cs')
  assert.equal(p.primaryAction.type, 'qadsDraft')
  assert.deepEqual(p.primaryAction.payload, { productName: 'Mug', productDescription: 'Big mug', projectId: 'p1', language: 'cs' })
  const [applied, proposed] = M.qgentItems([
    { id: 'q1', project_id: 'p1', title: 'A', status: 'applied', created_at: '2026-10-01T00:00:00Z' },
    { id: 'q2', project_id: 'p1', title: 'B', status: 'proposed', created_at: '2026-10-01T00:00:00Z' },
    { id: 'q3', project_id: 'p1', title: 'C', status: 'rejected', created_at: '2026-10-01T00:00:00Z' },
  ])
  assert.equal(applied.actions[0].type, 'qgentRevert', 'undo only for an applied change')
  assert.ok(applied.actions[0].confirm)
  assert.equal(proposed.actions.length, 0)
  assert.equal(proposed.status, 'open')
  const [scan] = M.qscanItems([{ id: 's', url: 'https://old.cz/', status: 'done', created_at: '2026-10-01T00:00:00Z', project_id: 'p1' }])
  assert.equal(scan.primaryAction.href, '/project/p1')
  // Sharing is the existing opt-in, always asked first.
  const [video] = M.qadsItems(
    [{ id: 'g', project_id: null, product_name: 'Mug', status: 'completed', created_at: '2026-10-01T00:00:00Z', share_community: false }],
    [{ id: 'i', generation_id: 'g', kind: 'video', format: '9:16', status: 'completed', created_at: '2026-10-01T00:00:00Z' }],
    new Map([['i', { view: 'https://v', download: 'https://d' }]]),
  )
  assert.equal(video.primaryAction.type, 'download')
  const share = video.actions.find((a) => a.type === 'qadsShare')
  assert.equal(share.payload.share, true)
  assert.ok(share.confirm, 'sharing asks first')
  const client = src('app/(app)/grideet/GrideetClient.tsx')
  assert.doesNotMatch(client, /\/api\/quante\/(generate|iterate)|\/api\/export['"`]|debit/, 'no credit-spending call from the grid')
})

// ─── Loader ─────────────────────────────────────────────────────────────────────────────────

const U = 'user_me'
const X = 'user_other'
const T = (d) => `2026-10-${String(d).padStart(2, '0')}T10:00:00Z`

function seed() {
  __db.tables = {
    projects: [
      { id: 'p1', user_id: U, name: 'Mine', status: 'ready', updated_at: T(10), created_at: T(1), store_slug: 'mine', custom_domain: null },
      { id: 'p2', user_id: U, name: 'Old', status: 'archived', updated_at: T(11), created_at: T(1) },
      { id: 'px', user_id: X, name: 'Theirs', status: 'ready', updated_at: T(12), created_at: T(1) },
    ],
    code_versions: [
      { id: 'v1', project_id: 'p1', user_id: U, created_at: T(5), files: { 'data/config.ts': 'export const config = { brand: { name: "Mine", language: "cs" }, design: { colors: { bg: "#fffaf0", text: "#111111", accent: "#c0392b" }, fonts: { heading: "Inter", body: "Inter" }, radius: "8px" } }', 'data/products.ts': 'export const products = [{ id: "1", name: "Mug", description: "Big", price: 10, images: ["https://img.test/mug.jpg"], slug: "mug", available: true }]' } },
      { id: 'v2', project_id: 'p1', user_id: U, created_at: T(6), files: { 'data/config.ts': 'export const config = { brand: { name: "Mine", language: "cs" }, design: { colors: { bg: "#fffaf0", text: "#111111", accent: "#c0392b" }, fonts: { heading: "Inter", body: "Inter" }, radius: "8px" } }', 'data/products.ts': 'export const products = [{ id: "1", name: "Mug", description: "Big", price: 10, images: ["https://img.test/mug.jpg"], slug: "mug", available: true }]' } },
    ],
    deployments: [{ id: 'd1', project_id: 'p1', user_id: U, status: 'ready', target: 'production', code_version_id: 'v1', created_at: T(5), domain: 'mine.stores.test', url: null }],
    qads_generations: [
      { id: 'g1', user_id: U, project_id: 'p1', product_name: 'Mug ad', status: 'completed', created_at: T(7), share_community: false, input_photo_urls: ['https://private/input.jpg'] },
      { id: 'g2', user_id: U, project_id: null, product_name: 'Loose ad', status: 'completed', created_at: T(8), share_community: true, input_photo_urls: ['https://private/input2.jpg'] },
      { id: 'gx', user_id: X, project_id: 'px', product_name: 'Their ad', status: 'completed', created_at: T(9) },
    ],
    qads_items: [
      { id: 'i1', generation_id: 'g1', user_id: U, kind: 'video', format: '9:16', status: 'completed', created_at: T(7), storage_bucket: 'qads-outputs', storage_path: 'u/i1.mp4' },
      { id: 'i2', generation_id: 'g2', user_id: U, kind: 'image', format: '1:1', status: 'completed', created_at: T(8), storage_bucket: 'qads-outputs', storage_path: 'u/i2.png' },
      { id: 'ix', generation_id: 'gx', user_id: X, kind: 'video', format: '9:16', status: 'completed', created_at: T(9), storage_bucket: 'qads-outputs', storage_path: 'x/ix.mp4' },
    ],
    qscan_scans: [
      { id: 's1', user_id: U, url: 'https://old.cz/', status: 'done', created_at: T(4), project_id: null, summary: { brand: { name: 'Old shop' }, products: 3 } },
      { id: 'sx', user_id: X, url: 'https://theirs.cz/', status: 'done', created_at: T(4) },
    ],
    qgent_actions: [
      { id: 'q1', user_id: U, project_id: 'p1', title: 'Sharper hero', status: 'proposed', created_at: T(9), updated_at: T(9) },
      { id: 'qx', user_id: X, project_id: 'px', title: 'Theirs', status: 'proposed', created_at: T(9), updated_at: T(9) },
    ],
    exports: [
      { id: 'e1', project_id: 'p1', 'projects.user_id': U, created_at: T(3), size_bytes: 2048 },
      { id: 'ex', project_id: 'px', 'projects.user_id': X, created_at: T(3) },
    ],
  }
}

beforeEach(() => { __db.reset(); seed() })

test('the loader returns only the signed-in user’s rows', async () => {
  const d = await loadGrideet(U, {})
  const all = d.groups.flatMap((g) => [g.id, ...g.items.map((i) => i.id + ' ' + i.title)]).join('|')
  assert.doesNotMatch(all, /\bpx\b|Theirs|Their ad|theirs\.cz|qads:ix|qgent:qx|export:ex/, all)
  assert.deepEqual(d.groups.map((g) => g.id), ['p1', null], 'archived p2 is not a brand')
  assert.equal(d.storeCount, 1)
  for (const s of __db.signed) assert.ok(!s.paths.some((p) => p.startsWith('x/')), 'never signs someone else’s media')
  // Every query of the loader is scoped to the user (or to projects that already are).
  const load = src('lib/grideet/load.ts')
  for (const table of ['projects', 'deployments', 'code_versions', 'qads_generations', 'qads_items', 'qscan_scans', 'qgent_actions', 'generation_jobs', 'user_domains', 'hosting_subscriptions']) {
    const at = load.indexOf(`from('${table}')`)
    assert.ok(at > 0, table)
    assert.match(load.slice(at, at + 400), /\.eq\('user_id', userId\)|\.eq\('id', latestVersion/, `${table} is filtered by user_id`)
  }
  assert.match(load, /\.eq\('projects\.user_id', userId\)/, 'exports through the owning project')
})

test('a store card: state, domain, preview, products; media are short-lived signed URLs', async () => {
  const d = await loadGrideet(U, {})
  const mine = d.groups.find((g) => g.id === 'p1')
  assert.equal(mine.meta.state, 'changes', 'v2 is newer than the live v1')
  assert.equal(mine.meta.domain, 'mine.stores.test')
  assert.equal(mine.meta.theme.bg, '#fffaf0')
  assert.equal(mine.meta.theme.accent, '#c0392b')
  const kinds = mine.items.map((i) => i.kind).sort()
  assert.deepEqual(kinds, ['edit', 'export', 'product', 'video'])
  const video = mine.items.find((i) => i.kind === 'video')
  assert.match(video.thumb.src, /^https:\/\/signed\.test\/qads-outputs\/u\/i1\.mp4\?ttl=3600$/)
  assert.match(video.primaryAction.href, /download=/)
  assert.ok(MEDIA_URL_TTL_S <= 3600)
  const json = JSON.stringify(d)
  assert.doesNotMatch(json, /input\.jpg|input2\.jpg|private\//, 'uploaded product photos never reach the grid')
  const unassigned = d.groups.find((g) => g.id === null)
  assert.deepEqual(unassigned.items.map((i) => i.kind).sort(), ['photo', 'scan'])
})

test('missing tables and the not-yet-run Grideet migration never break the page', async () => {
  __db.missing = new Set(['qgent_actions', 'qscan_scans', 'exports', 'qads_items'])
  const d = await loadGrideet(U, {})
  assert.deepEqual(d.groups.map((g) => g.id), ['p1'], 'the store still shows; nothing is left unassigned')
  assert.ok(d.skipped.includes('qgent_actions') && d.skipped.includes('qscan_scans'))

  __db.reset(); seed()
  __db.missingColumns = { qscan_scans: ['project_id'], qads_generations: ['share_community'] }
  const e = await loadGrideet(U, {})
  const scan = e.groups.flatMap((g) => g.items).find((i) => i.kind === 'scan')
  assert.equal(scan.brandId, null, 'without migration-grideet.sql a scan is unassigned')
  assert.deepEqual(e.skipped, [])
  assert.match(src('supabase/migration-grideet.sql'), /ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects\(id\) ON DELETE SET NULL/)
})

test('filters and paging run on the server', async () => {
  const d = await loadGrideet(U, { module: 'qscan' })
  assert.deepEqual(d.groups.map((g) => g.id), [null])
  const p = await loadGrideet(U, { kind: 'product' })
  assert.deepEqual(p.groups.map((g) => [g.id, g.items.map((i) => i.title)]), [['p1', ['Mug']]])
  const s = await loadGrideet(U, { q: 'loose' })
  assert.deepEqual(s.groups.map((g) => g.id), [null])
})

test('Grideet replaced the dashboard and is an app route', () => {
  const { APP_PATHS } = { APP_PATHS: src('lib/domains.ts') }
  assert.match(APP_PATHS, /'\/grideet\/:path\*'/)
  assert.match(src('next.config.ts'), /source: '\/dashboard', destination: '\/grideet'/)
  assert.match(src('proxy.ts'), /'\/grideet\(\.\*\)'/, 'sign-in protected')
  assert.match(src('lib/auth/after-sign-in.ts'), /FALLBACK = '\/grideet'/)
  const page = src('app/(app)/grideet/page.tsx')
  for (const kept of ['BatchBanner', 'project_limit', 'archived', 'ensureWelcomeGrant']) assert.match(page, new RegExp(kept), kept)
  const client = src('app/(app)/grideet/GrideetClient.tsx')
  assert.match(client, /\/api\/export\/bulk/, 'Agency bulk export stays')
  assert.match(client, /method: 'DELETE'/, 'delete stays')
  assert.match(src('app/(app)/grideet/GrideetMedia.tsx'), /MAX_PLAYING = 6/)
})
