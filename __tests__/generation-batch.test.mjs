// Agency batch generation queue (lib/generation/batch.ts) against an in-memory database
// (__tests__/fakes): rows start queued in list order, at most AGENCY_BATCH_CONCURRENCY run, each
// finished store frees a slot, one batch per user at a time, and the daily fair-use cap holds.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const ROOT = new URL('../', import.meta.url)
const FAKES = new URL('./fakes/', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/supabase/admin') return nextResolve(new URL('supabase-admin.mjs', FAKES).href, context)
    if (specifier === 'next/server') return nextResolve(new URL('next-server.mjs', FAKES).href, context)
    if (specifier === './run' && context.parentURL?.includes('/lib/generation/')) return nextResolve(new URL('generation-run.mjs', FAKES).href, context)
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { __db } = await import('./fakes/supabase-admin.mjs')
const { __after } = await import('./fakes/next-server.mjs')
const { __runs } = await import('./fakes/generation-run.mjs')
const { createBatch, kickBatch, batchJobs, recentBatches, parseBatchItems } = await import('../lib/generation/batch.ts')
const { AGENCY_BATCH_CONCURRENCY, AGENCY_BATCH_SIZE, AGENCY_FAIR_USE } = await import('../lib/config.ts')

const U = 'user_agency'
const items = (n) => Array.from({ length: n }, (_, i) => ({ brief: `Store brief ${i + 1}`, name: `Shop ${i + 1}` }))
const jobs = () => __db.tables.generation_jobs ?? []
const byStatus = (s) => jobs().filter((j) => j.status === s).length

beforeEach(() => { __db.reset(); __after.queue.length = 0; __runs.length = 0 })

test('parseBatchItems: 1–20 stores, each with a brief', () => {
  assert.equal(parseBatchItems([]).ok, false)
  assert.equal(parseBatchItems(items(AGENCY_BATCH_SIZE + 1)).ok, false)
  assert.equal(parseBatchItems([{ brief: '  ' }]).ok, false)
  const ok = parseBatchItems([{ brief: ' a ', name: ' N ' }, { brief: 'b' }])
  assert.deepEqual(ok, { ok: true, items: [{ brief: 'a', name: 'N' }, { brief: 'b', name: '' }] })
})

test('a batch starts AGENCY_BATCH_CONCURRENCY stores, the rest wait in list order', async () => {
  const res = await createBatch(U, items(7))
  assert.equal(res.ok, true)
  assert.equal(jobs().length, 7)
  assert.equal(byStatus('running'), AGENCY_BATCH_CONCURRENCY)
  assert.equal(byStatus('queued'), 7 - AGENCY_BATCH_CONCURRENCY)
  const running = jobs().filter((j) => j.status === 'running').map((j) => j.batch_index).sort((a, b) => a - b)
  assert.deepEqual(running, [0, 1, 2, 3, 4].slice(0, AGENCY_BATCH_CONCURRENCY))
  assert.ok(jobs().every((j) => j.credits_debited === false))
})

test('finished stores free their slots; the next kick starts the rest; agency runs debit nothing', async () => {
  const { batchId } = await createBatch(U, items(7))
  await __after.flush()
  assert.equal(__runs.length, AGENCY_BATCH_CONCURRENCY)
  assert.ok(__runs.every((r) => r.agency === true && r.charged === false && r.existingProjectId === undefined))
  assert.equal(__runs[0].projectName, 'Shop 1')
  assert.equal(await kickBatch(batchId, U), 7 - AGENCY_BATCH_CONCURRENCY)
  await __after.flush()
  assert.equal(byStatus('completed'), 7)
  const list = await batchJobs(batchId, U)
  assert.deepEqual(list.map((j) => j.name), items(7).map((i) => i.name))
  assert.equal(await batchJobs(batchId, 'someone_else'), null)
})

test('repeated kicks never exceed the concurrency', async () => {
  const { batchId } = await createBatch(U, items(12))
  await Promise.all([kickBatch(batchId, U), kickBatch(batchId, U), kickBatch(batchId, U)])
  assert.equal(byStatus('running'), AGENCY_BATCH_CONCURRENCY)
})

test('one batch at a time: a second one backs out and leaves no rows', async () => {
  await createBatch(U, items(3))
  const second = await createBatch(U, items(2))
  assert.equal(second.ok, false)
  assert.equal(second.status, 409)
  assert.equal(jobs().length, 3)
})

test('a stale batch (its invocations died) does not block the next one', async () => {
  const { batchId } = await createBatch(U, items(2))
  const old = new Date(Date.now() - 11 * 60_000).toISOString()
  for (const j of jobs()) { j.created_at = old; if (j.batch_index === 0) j.code_version_id = 'cv1' }
  const next = await createBatch(U, items(2))
  assert.equal(next.ok, true)
  const first = jobs().filter((j) => j.batch_id === batchId)
  assert.deepEqual(first.map((j) => j.status).sort(), ['completed', 'failed'], 'saved code = completed, nothing saved = failed')
})

test('the daily fair-use cap counts the whole batch up front', async () => {
  const now = new Date().toISOString()
  __db.tables.generation_jobs = Array.from({ length: AGENCY_FAIR_USE.generationsPerDay - 3 }, (_, i) => ({ id: 'old' + i, user_id: U, status: 'completed', created_at: now }))
  const res = await createBatch(U, items(5))
  assert.equal(res.ok, false)
  assert.equal(res.status, 429)
  assert.match(res.error, /3 more/)
  assert.equal(jobs().length, AGENCY_FAIR_USE.generationsPerDay - 3)
})

test('recentBatches sums the statuses for the dashboard', async () => {
  const { batchId } = await createBatch(U, items(6))
  await __after.flush()
  const [b] = await recentBatches(U)
  assert.equal(b.batchId, batchId)
  assert.deepEqual([b.total, b.completed, b.queued], [6, AGENCY_BATCH_CONCURRENCY, 6 - AGENCY_BATCH_CONCURRENCY])
})
