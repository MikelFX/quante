// Qbox closed beta (lib/qbox/model.ts): API keys, request parsing, limits and minute counting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const M = await import('../lib/qbox/model.ts')
const H = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null })

test('API keys: shown once, stored as a hash, parsed strictly', () => {
  const k = M.newApiKey()
  assert.match(k.key, /^qbx_[A-Za-z0-9]{40}$/)
  assert.equal(k.hash, M.hashApiKey(k.key))
  assert.notEqual(k.hash, k.key)
  assert.ok(k.key.startsWith(k.prefix) && k.prefix.length === 10)
  assert.notEqual(M.newApiKey().key, k.key)
  assert.equal(M.apiKeyFrom(H({ authorization: `Bearer ${k.key}` })), k.key)
  assert.equal(M.apiKeyFrom(H({ 'x-api-key': k.key })), k.key)
  for (const bad of ['', 'Bearer', `Basic ${k.key}`, 'Bearer sk_live_123', `Bearer ${k.key}x`, `Bearer ${k.key.slice(0, -1)}-`]) {
    assert.equal(M.apiKeyFrom(H({ authorization: bad })), null, bad)
  }
})

test('create: allowlisted templates, clamped timeout, bounded ports/env', () => {
  const d = M.parseCreate({})
  assert.deepEqual([d.template, d.timeoutMs, d.ports, d.internet], ['node24', M.QBOX_BETA.defaultTimeoutMs, [], true])
  assert.equal(M.parseCreate({ timeoutMs: 1e9 }).timeoutMs, M.QBOX_BETA.maxTimeoutMs)
  assert.equal(M.parseCreate({ timeoutMs: 5 }).timeoutMs, M.QBOX_BETA.minTimeoutMs)
  assert.equal(M.parseCreate({ internet: false }).internet, false)
  assert.deepEqual(M.parseCreate({ ports: [3000, 3000] }).ports, [3000])
  assert.deepEqual(M.parseCreate({ env: { API_URL: 'x' } }).env, { API_URL: 'x' })
  for (const bad of [{ template: 'ubuntu' }, { template: 'node24; rm -rf /' }, { ports: [80] }, { ports: [3000, 3001, 3002] }, { env: { 'A B': '1' } }, { env: { A: 1 } }, { internet: 'no' }]) {
    assert.throws(() => M.parseCreate(bad), M.QboxInputError, JSON.stringify(bad))
  }
})

test('exec: argv or a shell line; cwd normalised; timeout capped', () => {
  assert.deepEqual(M.parseExec({ cmd: 'npm', args: ['test'] }).args, ['test'])
  const s = M.parseExec({ command: 'npm test && ls' })
  assert.deepEqual([s.cmd, s.args], ['sh', ['-c', 'npm test && ls']])
  assert.equal(M.parseExec({ cmd: 'ls', cwd: 'src/../app' }).cwd, '/vercel/sandbox/app')
  assert.equal(M.parseExec({ cmd: 'ls', timeoutMs: 1e9 }).timeoutMs, M.QBOX_BETA.maxCommandMs)
  for (const bad of [null, {}, { cmd: '' }, { cmd: 'a\0b' }, { cmd: 'ls', args: [1] }, { command: '' }]) {
    assert.throws(() => M.parseExec(bad), M.QboxInputError, JSON.stringify(bad))
  }
})

test('paths: relative to the working directory, absolute kept, empty refused', () => {
  assert.equal(M.sandboxPath('out.txt'), '/vercel/sandbox/out.txt')
  assert.equal(M.sandboxPath('/tmp//a/./b.txt'), '/tmp/a/b.txt')
  assert.equal(M.sandboxPath('../../etc/hosts'), '/etc/hosts')
  for (const bad of ['', '   ', '/', null, 'a\0b', 'x'.repeat(2000)]) assert.throws(() => M.sandboxPath(bad), M.QboxInputError)
})

const T0 = Date.UTC(2026, 10, 15, 12, 0, 0)
const row = (startMin, lifeMin, extra = {}) => ({
  id: String(startMin), status: 'running', ended_at: null,
  created_at: new Date(T0 + startMin * 60_000).toISOString(),
  expires_at: new Date(T0 + (startMin + lifeMin) * 60_000).toISOString(), ...extra,
})
const LIM = { maxConcurrent: 2, monthlyMinutes: 60 }

test('minutes: from start to stop / timeout / now, only inside this month', () => {
  const ms = M.monthStartUtc(T0)
  assert.equal(ms, Date.UTC(2026, 10, 1))
  assert.equal(M.usedMinutes(row(-10, 30), T0, ms), 10) // running, 10 min so far
  assert.equal(M.usedMinutes(row(-60, 30), T0, ms), 30) // timed out
  assert.equal(M.usedMinutes(row(-10, 30, { ended_at: new Date(T0 - 5 * 60_000).toISOString(), status: 'stopped' }), T0, ms), 5)
  const lastMonth = { ...row(0, 30), created_at: new Date(ms - 10 * 60_000).toISOString(), expires_at: new Date(ms + 20 * 60_000).toISOString() }
  assert.equal(M.usedMinutes(lastMonth, ms + 60 * 60_000, ms), 20)
})

test('admission: concurrency, reserved minutes and the global cap', () => {
  assert.equal(M.admitCreate([], LIM, 5 * 60_000, T0, 0).ok, true)
  const two = [row(-1, 10), row(-2, 10)]
  assert.equal(M.admitCreate(two, LIM, 60_000, T0, 2).ok, false) // 2 running
  assert.equal(M.admitCreate([row(-120, 10), row(-100, 10)], LIM, 60_000, T0, 0).ok, true) // both expired
  // 50 minutes used + 1 running reserved for 10 more → a 5-minute sandbox would pass 60.
  const used = [row(-200, 50), row(-1, 11)]
  const r = M.admitCreate(used, LIM, 5 * 60_000, T0, 1)
  assert.equal(r.ok, false)
  assert.match(r.error, /Monthly beta limit/)
  assert.equal(M.admitCreate([], LIM, 60_000, T0, M.QBOX_BETA.globalConcurrent).ok, false)
})

test('the API is key-authenticated, engine-agnostic and fails closed', () => {
  const src = (f) => readFileSync(ROOT + f, 'utf8')
  const create = src('app/api/qbox/v1/sandboxes/route.ts')
  // The row (reserved slot + minutes) is written before the engine starts anything.
  assert.ok(create.indexOf("from('qbox_sandboxes').insert") < create.indexOf('engine().create('))
  for (const f of ['app/api/qbox/v1/sandboxes/route.ts', 'app/api/qbox/v1/sandboxes/[id]/route.ts', 'app/api/qbox/v1/sandboxes/[id]/exec/route.ts', 'app/api/qbox/v1/sandboxes/[id]/files/route.ts']) {
    const s = src(f)
    assert.ok(/await authenticate\(request\)/.test(s), `${f} checks the API key`)
    assert.ok(!/@vercel\/sandbox/.test(s), `${f} talks to the engine interface only`)
  }
  assert.ok(/'\/api\/qbox\/v1\/\(\.\*\)'/.test(src('proxy.ts')), 'API-key routes are exempt from the cookie CSRF check')
  assert.ok(!/process\.env\.(VERCEL_TOKEN|SUPABASE)/.test(src('lib/qbox/vercel.ts').split('env: input.env')[1] ?? ''), 'no platform secret goes into a sandbox')
})

test('admin: invite / pause / resume / remove one Clerk account, optional limits', () => {
  const id = 'user_3El2cd7br6xR9CQ4iveT02qYjRc'
  assert.deepEqual(M.parseAdminAction({ userId: id, action: 'invite' }), { action: 'invite', userId: id, maxConcurrent: null, monthlyMinutes: null })
  assert.equal(M.parseAdminAction({ userId: id, action: 'invite', monthlyMinutes: 1200 }).monthlyMinutes, 1200)
  for (const a of ['pause', 'resume', 'remove']) assert.equal(M.parseAdminAction({ userId: ` ${id} `, action: a }).action, a)
  for (const bad of [null, { userId: id }, { userId: id, action: 'drop' }, { userId: 'bob', action: 'invite' }, { userId: "user_x'; drop table", action: 'invite' }, { userId: id, action: 'invite', maxConcurrent: 0 }, { userId: id, action: 'invite', monthlyMinutes: 1.5 }]) {
    assert.throws(() => M.parseAdminAction(bad), M.QboxInputError, JSON.stringify(bad))
  }
  const src = readFileSync(ROOT + 'app/api/admin/qbox/route.ts', 'utf8')
  assert.equal((src.match(/await requireAdmin\(\)/g) ?? []).length, 2, 'both admin handlers are gated')
})
