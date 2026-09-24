// Scaffold rollout decision rules (lib/hosting/scaffold-rollout-rules.ts): which build
// is LIVE in production (incl. legacy rows without `target`), when a store is outdated,
// and the retry cap.
// Usage: node --test __tests__/scaffold-rollout.test.mjs
//
// Imports the real TypeScript modules through Node's built-in type stripping (like
// store-file-filter.test.mjs), so the rules under test can't drift from a copy.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const rules = await import(new URL('../lib/hosting/scaffold-rollout-rules.ts', import.meta.url).href)
const { SCAFFOLD_VERSION } = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)
const {
  isProductionRow,
  rowScaffoldVersion,
  pickLiveDeployment,
  pickLiveCodeVersionId,
  evaluateScaffoldState,
  isStoreOutdated,
  isAttemptCapped,
  rowsNeedingSettle,
  classifyDeploymentRow,
  ambiguousRowsToResolve,
  outdatedSkipReason,
  projectSyncPatch,
  BUILDING_FRESH_MS,
  MAX_SCAFFOLD_UPDATE_ATTEMPTS,
} = rules

const ROOT = 'stores.quantecode.com'
const NOW = Date.parse('2026-09-24T12:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()

let seq = 0
function row(over = {}) {
  seq++
  return {
    id: `row-${seq}`,
    vercel_deployment_id: `dpl_${seq}`,
    status: 'ready',
    created_at: ago(60),
    code_version_id: `cv-${seq}`,
    domain: null,
    url: `https://store-${seq}-team.vercel.app`,
    ...over,
  }
}
const evalOpts = { currentVersion: 2, now: NOW }

// ─── SCAFFOLD_VERSION ─────────────────────────────────────────────────────────

test('SCAFFOLD_VERSION is an integer >= 2 (2 = security refactor 2026-09)', () => {
  assert.ok(Number.isInteger(SCAFFOLD_VERSION))
  assert.ok(SCAFFOLD_VERSION >= 2)
})

// ─── Production-row detection ─────────────────────────────────────────────────

test('explicit target wins over domain / url', () => {
  assert.equal(isProductionRow(row({ target: 'production' })), true)
  assert.equal(isProductionRow(row({ target: 'preview', domain: `x.${ROOT}` })), false)
  assert.equal(isProductionRow(row({ target: 'maintenance', url: `https://x.${ROOT}` })), false)
})

test('legacy rows: domain set or public url = production; raw vercel.app / no url = ambiguous (not production)', () => {
  assert.equal(isProductionRow(row({ domain: `shop.${ROOT}` })), true)
  assert.equal(isProductionRow(row({ url: `https://shop.${ROOT}` })), true)
  assert.equal(isProductionRow(row({ url: `shop.${ROOT}` })), true)
  // Same rule as the checkout pricing had: any public (non-*.vercel.app) URL — the
  // server only ever writes the store subdomain / public domain there.
  assert.equal(isProductionRow(row({ url: 'https://shop.example.com' })), true)
  assert.equal(isProductionRow(row({})), false)
  assert.equal(classifyDeploymentRow(row({})), 'ambiguous')
  assert.equal(isProductionRow(row({ url: 'https://vercel.app' })), false)
  assert.equal(isProductionRow(row({ url: null })), false)
  assert.equal(classifyDeploymentRow(row({ url: null })), 'ambiguous')
  // Restore rows recorded the raw host as domain — still production.
  assert.equal(isProductionRow(row({ domain: 'q-abc-team.vercel.app' })), true)
})

test('classifyDeploymentRow: explicit targets', () => {
  assert.equal(classifyDeploymentRow(row({ target: 'production' })), 'production')
  assert.equal(classifyDeploymentRow(row({ target: 'preview' })), 'preview')
  assert.equal(classifyDeploymentRow(row({ target: 'maintenance', domain: `x.${ROOT}` })), 'maintenance')
  assert.equal(classifyDeploymentRow(row({ target: 'something-else', domain: `x.${ROOT}` })), 'preview')
})

test('scaffold_version null/missing/invalid reads as 1', () => {
  assert.equal(rowScaffoldVersion(row({ scaffold_version: null })), 1)
  assert.equal(rowScaffoldVersion(row({})), 1)
  assert.equal(rowScaffoldVersion(row({ scaffold_version: 0 })), 1)
  assert.equal(rowScaffoldVersion(row({ scaffold_version: 2 })), 2)
})

// ─── Live version selection ───────────────────────────────────────────────────

test('live = newest READY production row, never a newer preview draft', () => {
  const live = row({ domain: `s.${ROOT}`, created_at: ago(120), code_version_id: 'cv-live' })
  const draftPreview = row({ target: 'preview', created_at: ago(5), code_version_id: 'cv-draft' })
  const legacyPreview = row({ created_at: ago(10), code_version_id: 'cv-draft-2' })
  const rows = [draftPreview, legacyPreview, live]
  assert.equal(pickLiveDeployment(rows).id, live.id)
  assert.equal(pickLiveCodeVersionId(rows), 'cv-live')
})

test('failed / building production rows are skipped when picking the live build', () => {
  const live = row({ target: 'production', created_at: ago(300), code_version_id: 'cv-live' })
  const failed = row({ target: 'production', status: 'error', created_at: ago(30), code_version_id: 'cv-bad' })
  const building = row({ target: 'production', status: 'building', created_at: ago(2), code_version_id: 'cv-new' })
  assert.equal(pickLiveCodeVersionId([building, failed, live]), 'cv-live')
})

test('rows are ordered by created_at regardless of input order', () => {
  const older = row({ target: 'production', created_at: ago(500), code_version_id: 'cv-old' })
  const newer = row({ target: 'production', created_at: ago(50), code_version_id: 'cv-new' })
  assert.equal(pickLiveCodeVersionId([older, newer]), 'cv-new')
})

test('no ready production row → null (never falls back to the latest draft)', () => {
  const rows = [
    row({ target: 'preview', code_version_id: 'cv-draft' }),
    row({ target: 'production', status: 'error' }),
    row({ target: 'maintenance', code_version_id: null }),
  ]
  assert.equal(pickLiveDeployment(rows), null)
  assert.equal(pickLiveCodeVersionId(rows), null)
  assert.equal(pickLiveCodeVersionId([]), null)
})

test('live row without a code_version_id → null (skip, do not guess)', () => {
  const rows = [row({ target: 'production', code_version_id: null, created_at: ago(5) }), row({ target: 'production', created_at: ago(500) })]
  assert.equal(pickLiveCodeVersionId(rows), null)
})

// ─── Outdated detection ───────────────────────────────────────────────────────

test('legacy live build (no scaffold_version) is outdated', () => {
  const rows = [row({ domain: `s.${ROOT}` })]
  const e = evaluateScaffoldState(rows, evalOpts)
  assert.equal(e.state, 'outdated')
  assert.equal(e.outdated, true)
  assert.equal(e.liveScaffoldVersion, 1)
  assert.equal(isStoreOutdated(rows, evalOpts), true)
})

test('live build at the current version is up to date', () => {
  const rows = [row({ target: 'production', scaffold_version: 2 })]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'up_to_date')
  assert.equal(isStoreOutdated(rows, evalOpts), false)
})

test('a newer version than current also counts as up to date', () => {
  assert.equal(evaluateScaffoldState([row({ target: 'production', scaffold_version: 3 })], evalOpts).state, 'up_to_date')
})

test('failed rollout build is ignored → still outdated (retry)', () => {
  const rows = [
    row({ target: 'production', scaffold_version: 2, status: 'error', created_at: ago(20) }),
    row({ target: 'production', scaffold_version: 2, status: 'canceled', created_at: ago(10) }),
    row({ domain: `s.${ROOT}`, created_at: ago(600) }),
  ]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'outdated')
})

test('fresh current-version production build in progress → building, not outdated', () => {
  const rows = [
    row({ target: 'production', scaffold_version: 2, status: 'building', created_at: ago(3) }),
    row({ domain: `s.${ROOT}`, created_at: ago(600) }),
  ]
  const e = evaluateScaffoldState(rows, evalOpts)
  assert.equal(e.state, 'building')
  assert.equal(e.outdated, false)
  assert.equal(e.liveScaffoldVersion, 1)
  assert.equal(e.buildingRow.id, rows[0].id)
  assert.equal(evaluateScaffoldState([row({ target: 'production', scaffold_version: 2, status: 'queued', created_at: ago(1) })], evalOpts).state, 'building')
})

test('stale in-progress build (older than 15 min) does not block a retry', () => {
  const rows = [
    row({ target: 'production', scaffold_version: 2, status: 'building', created_at: new Date(NOW - BUILDING_FRESH_MS - 1000).toISOString() }),
    row({ domain: `s.${ROOT}`, created_at: ago(600) }),
  ]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'outdated')
})

test('an in-progress build at an OLD scaffold version does not count as building', () => {
  const rows = [
    row({ domain: `s.${ROOT}`, status: 'building', created_at: ago(2) }),
    row({ domain: `s.${ROOT}`, created_at: ago(600) }),
  ]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'outdated')
})

test('in-progress preview builds never count', () => {
  const rows = [
    row({ target: 'preview', scaffold_version: 2, status: 'building', created_at: ago(1) }),
    row({ domain: `s.${ROOT}`, created_at: ago(600) }),
  ]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'outdated')
})

test('no live production build → no_live_version (not outdated)', () => {
  const e = evaluateScaffoldState([row({ target: 'preview' })], evalOpts)
  assert.equal(e.state, 'no_live_version')
  assert.equal(e.outdated, false)
})

test('newest ready production row decides even when an older one is current', () => {
  const rows = [
    row({ domain: `s.${ROOT}`, created_at: ago(10) }), // legacy, v1, newest ready
    row({ target: 'production', scaffold_version: 2, created_at: ago(100) }),
  ]
  assert.equal(evaluateScaffoldState(rows, evalOpts).state, 'outdated')
})

// ─── Attempt cap ──────────────────────────────────────────────────────────────

test('attempt cap: >= 3 attempts is capped; missing/0/2 are not', () => {
  assert.equal(MAX_SCAFFOLD_UPDATE_ATTEMPTS, 3)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: 3 }), true)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: 7 }), true)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: 2 }), false)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: 0 }), false)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: null }), false)
  assert.equal(isAttemptCapped({}), false)
  assert.equal(isAttemptCapped({ scaffold_update_attempts: 1 }, 1), true)
})

// ─── Settling stale rows ──────────────────────────────────────────────────────

test('rowsNeedingSettle: only in-progress production rows newer than the newest ready one', () => {
  const unpolledRestore = row({ domain: `s.${ROOT}`, status: 'building', created_at: ago(900) })
  const readyOld = row({ domain: `s.${ROOT}`, created_at: ago(2000) })
  const olderBuilding = row({ domain: `s.${ROOT}`, status: 'building', created_at: ago(3000) })
  const previewBuilding = row({ target: 'preview', status: 'building', created_at: ago(1) })
  const noVercelId = row({ target: 'production', status: 'queued', created_at: ago(5), vercel_deployment_id: null })
  const out = rowsNeedingSettle([previewBuilding, unpolledRestore, readyOld, olderBuilding, noVercelId])
  assert.deepEqual(out.map((r) => r.id), [unpolledRestore.id])
})

test('rowsNeedingSettle respects the max', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row({ target: 'production', status: 'building', created_at: ago(i + 1) }))
  assert.equal(rowsNeedingSettle(rows, 6).length, 6)
})

test('rowsNeedingSettle: newest first', () => {
  const a = row({ target: 'production', status: 'building', created_at: ago(30) })
  const b = row({ target: 'production', status: 'queued', created_at: ago(3) })
  assert.deepEqual(rowsNeedingSettle([a, b]).map((r) => r.id), [b.id, a.id])
})

// ─── Legacy rows of unknown target ────────────────────────────────────────────

test('ambiguousRowsToResolve: only unknown-target rows newer than the live production row', () => {
  const live = row({ domain: `s.${ROOT}`, created_at: ago(600), code_version_id: 'cv-old' })
  // Redeploy / iterate production build whose subdomain attach failed — or a preview.
  const unknownNewer = row({ created_at: ago(60), code_version_id: 'cv-new' })
  const unknownFailed = row({ status: 'error', created_at: ago(50) })
  const unknownNoId = row({ created_at: ago(40), vercel_deployment_id: null })
  const unknownOlder = row({ created_at: ago(900) })
  const knownPreview = row({ target: 'preview', created_at: ago(20) })
  const out = ambiguousRowsToResolve([live, unknownNewer, unknownFailed, unknownNoId, unknownOlder, knownPreview])
  assert.deepEqual(out.map((r) => r.id), [unknownNewer.id])
})

test('ambiguousRowsToResolve: no live row → every non-failed unknown row, newest first, capped', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row({ created_at: ago(i + 1) }))
  const out = ambiguousRowsToResolve(rows, 3)
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((r) => r.id), rows.slice(0, 3).map((r) => r.id))
})

test('a legacy production build with a failed subdomain attach, once resolved, is the live one', () => {
  const olderLive = row({ domain: `s.${ROOT}`, created_at: ago(600), code_version_id: 'cv-old' })
  const attachFailed = row({ created_at: ago(60), code_version_id: 'cv-new' })
  // Unresolved it is not production (the rollout must resolve it first) …
  assert.equal(pickLiveCodeVersionId([olderLive, attachFailed]), 'cv-old')
  assert.equal(ambiguousRowsToResolve([olderLive, attachFailed]).length, 1)
  // … and after Vercel confirmed target=production it wins.
  assert.equal(pickLiveCodeVersionId([olderLive, { ...attachFailed, target: 'production' }]), 'cv-new')
  // Resolved as a preview it stays out.
  assert.equal(pickLiveCodeVersionId([olderLive, { ...attachFailed, target: 'preview' }]), 'cv-old')
})

// ─── Batch skip reasons ───────────────────────────────────────────────────────

test('outdatedSkipReason: live row without code version → no_live_version (never takes a batch slot)', () => {
  const e = evaluateScaffoldState([row({ domain: `s.${ROOT}`, code_version_id: null })], evalOpts)
  assert.equal(e.state, 'outdated')
  assert.equal(outdatedSkipReason(e, { scaffold_update_attempts: 0 }), 'no_live_version')
})

test('outdatedSkipReason: attempt cap unless ignored; updatable otherwise', () => {
  const e = evaluateScaffoldState([row({ domain: `s.${ROOT}` })], evalOpts)
  assert.equal(outdatedSkipReason(e, { scaffold_update_attempts: 3 }), 'attempts_exhausted')
  assert.equal(outdatedSkipReason(e, { scaffold_update_attempts: 3 }, { ignoreAttemptCap: true }), null)
  assert.equal(outdatedSkipReason(e, { scaffold_update_attempts: 2 }), null)
})

// ─── Project bookkeeping sync ─────────────────────────────────────────────────

test('projectSyncPatch: up to date with leftover attempts / stale version → reset', () => {
  const e = evaluateScaffoldState([row({ target: 'production', scaffold_version: 2 })], evalOpts)
  assert.deepEqual(
    projectSyncPatch({ scaffold_version: null, scaffold_update_attempts: 1, scaffold_update_error: null }, e),
    { scaffold_version: 2, scaffold_update_attempts: 0, scaffold_update_error: null },
  )
  assert.deepEqual(
    projectSyncPatch({ scaffold_version: 2, scaffold_update_attempts: 0, scaffold_update_error: 'old failure' }, e),
    { scaffold_version: 2, scaffold_update_attempts: 0, scaffold_update_error: null },
  )
  assert.equal(projectSyncPatch({ scaffold_version: 2, scaffold_update_attempts: 0, scaffold_update_error: null }, e), null)
})

test('projectSyncPatch: nothing to write unless up to date', () => {
  const outdated = evaluateScaffoldState([row({ domain: `s.${ROOT}` })], evalOpts)
  assert.equal(projectSyncPatch({ scaffold_update_attempts: 2 }, outdated), null)
  const building = evaluateScaffoldState([row({ target: 'production', scaffold_version: 2, status: 'building', created_at: ago(1) })], evalOpts)
  assert.equal(projectSyncPatch({ scaffold_update_attempts: 2 }, building), null)
})

test('successive successful updates never accumulate toward the cap', () => {
  // v2 success settled by the Studio poll (projects untouched), then sync on next scan.
  let project = { scaffold_version: null, scaffold_update_attempts: 1, scaffold_update_error: null }
  const e = evaluateScaffoldState([row({ target: 'production', scaffold_version: 2 })], evalOpts)
  project = { ...project, ...projectSyncPatch(project, e) }
  assert.equal(project.scaffold_update_attempts, 0)
  assert.equal(isAttemptCapped(project), false)
})
