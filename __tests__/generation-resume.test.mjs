// Level 2 client reconnect — pure logic from app/(app)/new/page.tsx's localStorage marker
// (savePending/loadPending/clearPending) and the resume-candidate matching logic used by
// checkForResumableProject().
// Usage: node --test __tests__/generation-resume.test.mjs
// Or via: npm run test:generation-resume
//
// Inlines plain-JS copies of the relevant logic (must stay in sync with page.tsx) — same
// convention as __tests__/store-health.test.mjs, since these tests run via plain
// `node --test` without a TypeScript loader or a DOM/React renderer. A minimal in-memory
// fake stands in for window.localStorage.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── fake localStorage (Map-backed, mirrors the Web Storage API surface actually used) ──

function makeFakeLocalStorage() {
  const store = new Map()
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }
}

// ─── app/(app)/new/page.tsx (inlined copy of the pure/localStorage-adjacent logic) ──────

const PENDING_KEY = 'quante:pending-generation'
const PENDING_MAX_AGE_MS = 10 * 60_000

function savePending(ls, data) {
  try { ls.setItem(PENDING_KEY, JSON.stringify(data)) } catch {}
}

function loadPending(ls) {
  try {
    const raw = ls.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.startedAt !== 'number' || typeof parsed?.brief !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function clearPending(ls) {
  try { ls.removeItem(PENDING_KEY) } catch {}
}

function isPendingStale(startedAt, now) {
  return now - startedAt > PENDING_MAX_AGE_MS
}

// Mirrors the filter/sort inside checkForResumableProject().
function findResumableProject(projects, startedAt) {
  const cutoff = startedAt - 10_000
  return projects
    .filter((p) => new Date(p.created_at).getTime() > cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
}

// ─── tests: save/load/clear round-trip ──────────────────────────────────────────────────

test('savePending + loadPending: round-trips exactly what was saved', () => {
  const ls = makeFakeLocalStorage()
  const data = { startedAt: 1000, brief: 'A coffee shop', projectName: 'Brew', jobId: null }
  savePending(ls, data)
  assert.deepEqual(loadPending(ls), data)
})

test('loadPending: nothing saved yet → null', () => {
  const ls = makeFakeLocalStorage()
  assert.equal(loadPending(ls), null)
})

test('loadPending: corrupt JSON → null, not a throw', () => {
  const ls = makeFakeLocalStorage()
  ls.setItem(PENDING_KEY, '{not valid json')
  assert.equal(loadPending(ls), null)
})

test('loadPending: valid JSON but missing required fields → null', () => {
  const ls = makeFakeLocalStorage()
  ls.setItem(PENDING_KEY, JSON.stringify({ jobId: 'abc' })) // no startedAt/brief
  assert.equal(loadPending(ls), null)
})

test('loadPending: startedAt present but wrong type → null', () => {
  const ls = makeFakeLocalStorage()
  ls.setItem(PENDING_KEY, JSON.stringify({ startedAt: '1000', brief: 'x' }))
  assert.equal(loadPending(ls), null)
})

test('clearPending: removes the key; a subsequent load sees nothing', () => {
  const ls = makeFakeLocalStorage()
  savePending(ls, { startedAt: 1, brief: 'x', projectName: '', jobId: null })
  clearPending(ls)
  assert.equal(loadPending(ls), null)
})

test('savePending: a second save overwrites the first (used when the job event arrives)', () => {
  const ls = makeFakeLocalStorage()
  savePending(ls, { startedAt: 1000, brief: 'A coffee shop', projectName: '', jobId: null })
  savePending(ls, { startedAt: 1000, brief: 'A coffee shop', projectName: '', jobId: 'job-123' })
  assert.equal(loadPending(ls).jobId, 'job-123')
})

// ─── tests: staleness cutoff ─────────────────────────────────────────────────────────────

test('isPendingStale: just under the 10-minute cutoff → not stale', () => {
  const startedAt = 0
  const now = PENDING_MAX_AGE_MS - 1
  assert.equal(isPendingStale(startedAt, now), false)
})

test('isPendingStale: just over the 10-minute cutoff → stale', () => {
  const startedAt = 0
  const now = PENDING_MAX_AGE_MS + 1
  assert.equal(isPendingStale(startedAt, now), true)
})

test('isPendingStale: freshly created (now === startedAt) → not stale', () => {
  assert.equal(isPendingStale(5000, 5000), false)
})

// ─── tests: findResumableProject ─────────────────────────────────────────────────────────

test('findResumableProject: no projects at all → null', () => {
  assert.equal(findResumableProject([], 1_000_000), null)
})

test('findResumableProject: only projects created before the generation started → null', () => {
  const startedAt = 1_000_000
  const projects = [{ id: 'old-1', created_at: new Date(startedAt - 60_000).toISOString() }]
  assert.equal(findResumableProject(projects, startedAt), null)
})

test('findResumableProject: a project created just after startedAt matches', () => {
  const startedAt = 1_000_000
  const projects = [{ id: 'new-1', created_at: new Date(startedAt + 5_000).toISOString() }]
  assert.equal(findResumableProject(projects, startedAt).id, 'new-1')
})

test('findResumableProject: 10s clock-skew buffer — a project created just before startedAt (within the buffer) still matches', () => {
  const startedAt = 1_000_000
  const projects = [{ id: 'skewed', created_at: new Date(startedAt - 5_000).toISOString() }]
  assert.equal(findResumableProject(projects, startedAt).id, 'skewed')
})

test('findResumableProject: a project created exactly at the 10s buffer boundary (excluded, > not >=) does not match', () => {
  const startedAt = 1_000_000
  const projects = [{ id: 'boundary', created_at: new Date(startedAt - 10_000).toISOString() }]
  assert.equal(findResumableProject(projects, startedAt), null)
})

test('findResumableProject: multiple matches → picks the most recently created', () => {
  const startedAt = 1_000_000
  const projects = [
    { id: 'first', created_at: new Date(startedAt + 1_000).toISOString() },
    { id: 'second', created_at: new Date(startedAt + 5_000).toISOString() },
  ]
  assert.equal(findResumableProject(projects, startedAt).id, 'second')
})

test('findResumableProject: an unrelated old project mixed in with a real match is excluded from consideration', () => {
  const startedAt = 1_000_000
  const projects = [
    { id: 'unrelated-old', created_at: new Date(startedAt - 3_600_000).toISOString() },
    { id: 'the-match', created_at: new Date(startedAt + 2_000).toISOString() },
  ]
  assert.equal(findResumableProject(projects, startedAt).id, 'the-match')
})
