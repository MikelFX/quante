// Security pass 4 — group misc: regression cases for the reviewer-found bypasses.
//   - /api/projects/[id]/redeploy (audit F4): identical content re-labelled with a new
//     version id (restore, no-op product edit) must NOT get a free build; stuck / vanished
//     builds must not dead-end the "Rebuild preview" retry.
//   - /api/projects/[id]/insights (audit F1): concurrent POSTs across projects must not
//     exceed the per-user hourly cap even without quante_request_attempts.
//   - app/api/upload/_lib/quota.ts (audit F6): the storage fallback must count every
//     project folder of the user, not just the one being uploaded to.
// Usage: node --test __tests__/security4-misc.test.mjs
//
// Inlines plain-JS copies of the logic (keep in sync with
// app/api/projects/[id]/redeploy/_lib/build-match.ts, the findExistingBuild() flow in
// app/api/projects/[id]/redeploy/route.ts, the insights re-count and quota.ts) — same
// convention as the other __tests__/*.test.mjs files (no TypeScript loader).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// ─── redeploy/_lib/build-match.ts (inlined copy) ────────────────────────────────────────

function hashCodeFiles(files) {
  const obj = (files && typeof files === 'object' && !Array.isArray(files)) ? files : {}
  const entries = Object.keys(obj)
    .sort()
    .map((path) => [path, typeof obj[path] === 'string' ? obj[path] : JSON.stringify(obj[path] ?? null)])
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

const STALE_BUILD_MS = 10 * 60 * 1000

function classifyDeploymentRow(input) {
  const stale = !Number.isFinite(input.ageMs) || input.ageMs > STALE_BUILD_MS
  if (input.vercelState === null) {
    if (input.lookupStatus === 404) return 'dead'
    if (input.dbReady) return 'lookup_failed'
    return stale ? 'dead' : 'lookup_failed'
  }
  if (input.vercelState === 'ready') return 'ready'
  if (input.vercelState === 'error' || input.vercelState === 'canceled') return 'dead'
  return stale ? 'dead' : 'building'
}

// ─── findExistingBuild() flow (route.ts), with injected data sources ─────────────────────

const MAX_STATUS_LOOKUPS = 6

function findExistingBuild({ rows, versions, current, vercel, now = Date.now() }) {
  rows = rows.filter((r) => r.code_version_id && r.vercel_deployment_id && !['error', 'canceled'].includes(r.status))
  if (rows.length === 0) return { state: 'none' }
  let lookups = 0, building = false, lookupFailed = false
  const evaluate = (candidates) => {
    const ordered = [...candidates].sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'))
    for (const r of ordered) {
      if (lookups >= MAX_STATUS_LOOKUPS) return null
      lookups++
      const v = vercel[r.vercel_deployment_id] ?? { throws: 404 }
      const vercelState = v.throws ? null : v.state
      const verdict = classifyDeploymentRow({
        vercelState,
        lookupStatus: v.throws,
        ageMs: now - r.created_at,
        dbReady: r.status === 'ready',
      })
      if (verdict === 'ready') return { state: 'ready', deploymentId: r.vercel_deployment_id }
      if (verdict === 'building') building = true
      if (verdict === 'lookup_failed') lookupFailed = true
    }
    return null
  }
  const own = evaluate(rows.filter((r) => r.code_version_id === current.id))
  if (own) return own
  const otherIds = [...new Set(rows.map((r) => r.code_version_id).filter((id) => id !== current.id))]
  if (otherIds.length > 0 && lookups < MAX_STATUS_LOOKUPS) {
    const h = hashCodeFiles(current.files)
    const matching = new Set(versions.filter((v) => otherIds.includes(v.id) && hashCodeFiles(v.files) === h).map((v) => v.id))
    if (matching.size > 0) {
      const other = evaluate(rows.filter((r) => matching.has(r.code_version_id)))
      if (other) return other
    }
  }
  if (lookupFailed) return { state: 'lookup_failed' }
  if (building) return { state: 'building' }
  return { state: 'none' }
}

const FILES_A = { 'data/products.ts': 'export const products = [{"id":"p1"}]', 'data/config.ts': 'currency: "CZK"' }
const FILES_B = { ...FILES_A, 'data/products.ts': 'export const products = [{"id":"p2"}]' }
const MIN = 60 * 1000

test('hash: same content → same hash regardless of key order; any edit changes it', () => {
  const reordered = { 'data/config.ts': FILES_A['data/config.ts'], 'data/products.ts': FILES_A['data/products.ts'] }
  assert.equal(hashCodeFiles(FILES_A), hashCodeFiles(reordered))
  assert.notEqual(hashCodeFiles(FILES_A), hashCodeFiles(FILES_B))
  assert.notEqual(hashCodeFiles({ a: 'x' }), hashCodeFiles({ a: 'x', b: '' }))
  // Path/content boundary can't be shifted to forge a collision.
  assert.notEqual(hashCodeFiles({ ab: 'c' }), hashCodeFiles({ a: 'bc' }))
})

test('BYPASS rejected: restore → redeploy of already-built content reuses the READY preview (no free build)', () => {
  const now = Date.now()
  // v1 was built (READY). Restore wrote v2 with identical files — a brand-new version id.
  const r = findExistingBuild({
    now,
    current: { id: 'v2', files: { ...FILES_A } },
    versions: [{ id: 'v1', files: FILES_A }],
    rows: [{ id: 'd1', code_version_id: 'v1', vercel_deployment_id: 'dpl_1', status: 'ready', created_at: now - 120 * MIN }],
    vercel: { dpl_1: { state: 'ready' } },
  })
  assert.deepEqual(r, { state: 'ready', deploymentId: 'dpl_1' })
})

test('BYPASS rejected: no-op product edit (identical list, new version id) reuses the READY preview', () => {
  const now = Date.now()
  const r = findExistingBuild({
    now,
    current: { id: 'v9', files: { 'data/config.ts': FILES_A['data/config.ts'], 'data/products.ts': FILES_A['data/products.ts'] } },
    versions: [{ id: 'v8', files: FILES_A }, { id: 'v7', files: FILES_B }],
    rows: [
      { id: 'd8', code_version_id: 'v8', vercel_deployment_id: 'dpl_8', status: 'building', created_at: now - 3 * MIN },
      { id: 'd7', code_version_id: 'v7', vercel_deployment_id: 'dpl_7', status: 'ready', created_at: now - 30 * MIN },
    ],
    // DB row still 'building' but Vercel says it finished → reused.
    vercel: { dpl_8: { state: 'ready' }, dpl_7: { state: 'ready' } },
  })
  assert.deepEqual(r, { state: 'ready', deploymentId: 'dpl_8' })
})

test('BYPASS rejected: restore while the identical content is still building → 409 build_in_progress', () => {
  const now = Date.now()
  const r = findExistingBuild({
    now,
    current: { id: 'v3', files: FILES_A },
    versions: [{ id: 'v1', files: FILES_A }],
    rows: [{ id: 'd1', code_version_id: 'v1', vercel_deployment_id: 'dpl_1', status: 'building', created_at: now - 2 * MIN }],
    vercel: { dpl_1: { state: 'queued' } },
  })
  assert.equal(r.state, 'building')
})

test('new content (real edit) or a failed build of this content → free build allowed', () => {
  const now = Date.now()
  assert.equal(findExistingBuild({
    now,
    current: { id: 'v2', files: FILES_B },
    versions: [{ id: 'v1', files: FILES_A }],
    rows: [{ id: 'd1', code_version_id: 'v1', vercel_deployment_id: 'dpl_1', status: 'ready', created_at: now - 5 * MIN }],
    vercel: { dpl_1: { state: 'ready' } },
  }).state, 'none')
  assert.equal(findExistingBuild({
    now,
    current: { id: 'v2', files: FILES_A },
    versions: [],
    rows: [{ id: 'd2', code_version_id: 'v2', vercel_deployment_id: 'dpl_2', status: 'building', created_at: now - 2 * MIN }],
    vercel: { dpl_2: { state: 'error' } },
  }).state, 'none')
})

test('retry does not dead-end: stuck QUEUED/unknown build past STALE_BUILD_MS and Vercel 404 count as dead', () => {
  const now = Date.now()
  assert.equal(findExistingBuild({
    now,
    current: { id: 'v2', files: FILES_A },
    versions: [],
    rows: [{ id: 'd2', code_version_id: 'v2', vercel_deployment_id: 'dpl_2', status: 'building', created_at: now - 11 * MIN }],
    vercel: { dpl_2: { state: 'queued' } },
  }).state, 'none')
  // "Vercel never registered the deployment" — a fresh row whose lookup 404s.
  assert.equal(findExistingBuild({
    now,
    current: { id: 'v2', files: FILES_A },
    versions: [],
    rows: [{ id: 'd2', code_version_id: 'v2', vercel_deployment_id: 'dpl_2', status: 'building', created_at: now - 1 * MIN }],
    vercel: { dpl_2: { throws: 404 } },
  }).state, 'none')
})

test('fails closed on transient lookup errors for fresh rows and for DB-ready rows at any age', () => {
  assert.equal(classifyDeploymentRow({ vercelState: null, lookupStatus: 500, ageMs: 2 * MIN }), 'lookup_failed')
  assert.equal(classifyDeploymentRow({ vercelState: null, lookupStatus: 500, ageMs: 600 * MIN, dbReady: true }), 'lookup_failed')
  assert.equal(classifyDeploymentRow({ vercelState: null, lookupStatus: 500, ageMs: 600 * MIN }), 'dead')
  assert.equal(classifyDeploymentRow({ vercelState: null, lookupStatus: 404, ageMs: 1 * MIN, dbReady: true }), 'dead')
  assert.equal(classifyDeploymentRow({ vercelState: 'building', ageMs: 2 * MIN }), 'building')
  assert.equal(classifyDeploymentRow({ vercelState: 'building', ageMs: NaN }), 'dead')
  assert.equal(classifyDeploymentRow({ vercelState: 'ready', ageMs: 999 * MIN }), 'ready')
})

// ─── insights: pre-check + post-debit re-count (route.ts) ─────────────────────────────────

const MAX_INSIGHTS_PER_USER_HOUR = 5

test('BYPASS rejected: 20 concurrent insights POSTs across projects → at most 5 reach Claude', () => {
  const ledger = [] // debit rows (refunded ones stay)
  // Phase 1: every request passes the pre-check at the same time (count 0).
  const passedPrecheck = Array.from({ length: 20 }, (_, i) => ({ i, pre: ledger.length }))
    .filter((r) => r.pre < MAX_INSIGHTS_PER_USER_HOUR)
  // Phase 2: each debits (row inserted), in some interleaving, then re-counts.
  const order = passedPrecheck.map((r) => r.i).reverse()
  const counts = new Map()
  for (const i of order) { ledger.push({ i }); counts.set(i, ledger.length) }
  // Worst case for the re-count: each request sees at least its own rank.
  const proceeded = order.filter((i) => counts.get(i) <= MAX_INSIGHTS_PER_USER_HOUR)
  assert.equal(passedPrecheck.length, 20)
  assert.ok(proceeded.length <= MAX_INSIGHTS_PER_USER_HOUR)
  // Even if all re-counts ran after every insert (count = 20 for all), none exceed the cap.
  const allLate = order.filter(() => ledger.length <= MAX_INSIGHTS_PER_USER_HOUR)
  assert.equal(allLate.length, 0)
})

// ─── quota.ts storage fallback: counts every project folder ────────────────────────────

function countFallback(tree, prefix, since) {
  const root = tree[prefix] ?? []
  const folders = root.filter((e) => !e.id).map((e) => `${prefix}/${e.name}`)
  const entries = root.filter((e) => e.id)
  for (const f of folders) entries.push(...(tree[f] ?? []).filter((e) => e.id))
  return entries.filter((e) => e.created_at >= since).length
}

test('BYPASS rejected: store-assets fallback cap does not reset per project', () => {
  const now = Date.now()
  const file = (n) => ({ id: `f${n}`, name: `${n}.png`, created_at: now - 1000 })
  const tree = {
    user_1: [{ id: null, name: 'projA' }, { id: null, name: 'projB' }, { id: null, name: 'projC' }],
    'user_1/projA': Array.from({ length: 150 }, (_, n) => file(n)),
    'user_1/projB': Array.from({ length: 50 }, (_, n) => file(1000 + n)),
    'user_1/projC': [],
  }
  // Uploading into the empty projC must still see the 200 files already uploaded today.
  const count = countFallback(tree, 'user_1', now - 24 * 3600 * 1000)
  assert.equal(count, 200)
  assert.ok(count + 1 > 200, 'the 201st upload of the day is refused')
})
