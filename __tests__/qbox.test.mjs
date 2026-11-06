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
  assert.deepEqual([d.template, d.timeoutMs, d.ports, d.internet, d.vcpus], ['node24', M.QBOX_BETA.defaultTimeoutMs, [], 'open', 2])
  assert.equal(M.parseCreate({ timeoutMs: 1e9 }).timeoutMs, M.QBOX_BETA.maxTimeoutMs)
  assert.equal(M.parseCreate({ timeoutMs: 5 }).timeoutMs, M.QBOX_BETA.minTimeoutMs)
  assert.equal(M.parseCreate({ internet: false }).internet, 'none')
  assert.equal(M.parseCreate({ internet: 'registries' }).internet, 'registries')
  assert.deepEqual(M.parseCreate({ ports: [3000, 3000] }).ports, [3000])
  assert.deepEqual(M.parseCreate({ env: { API_URL: 'x' } }).env, { API_URL: 'x' })
  for (const bad of [{ template: 'ubuntu' }, { template: 'node24; rm -rf /' }, { ports: [80] }, { ports: [3000, 3001, 3002] }, { env: { 'A B': '1' } }, { env: { A: 1 } }, { internet: 'no' }, { vcpus: 4 }]) {
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
const IDLE = { live: 0, vcpuMinutesToday: 0 }

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
  assert.equal(M.admitCreate([], LIM, 5 * 60_000, T0, IDLE).ok, true)
  const two = [row(-1, 10), row(-2, 10)]
  assert.equal(M.admitCreate(two, LIM, 60_000, T0, { live: 2, vcpuMinutesToday: 0 }).ok, false) // 2 running
  assert.equal(M.admitCreate([row(-120, 10), row(-100, 10)], LIM, 60_000, T0, IDLE).ok, true) // both expired
  // 50 minutes used + 1 running reserved for 10 more → a 5-minute sandbox would pass 60.
  const used = [row(-200, 50), row(-1, 11)]
  const r = M.admitCreate(used, LIM, 5 * 60_000, T0, { live: 1, vcpuMinutesToday: 0 })
  assert.equal(r.ok, false)
  assert.match(r.error, /Monthly limit/)
  assert.equal(M.admitCreate([], LIM, 60_000, T0, { live: M.QBOX_GLOBAL.concurrent, vcpuMinutesToday: 0 }).ok, false)
  // The daily vCPU-minute budget: 1990 reserved + a 10-minute 2-vCPU sandbox (20) > 2000.
  const day = M.admitCreate([], { ...LIM, vcpus: 2 }, 10 * 60_000, T0, { live: 0, vcpuMinutesToday: 1990 })
  assert.equal(day.ok, false)
  assert.match(day.error, /today's capacity/)
  assert.equal(M.admitCreate([], { ...LIM, vcpus: 1 }, 10 * 60_000, T0, { live: 0, vcpuMinutesToday: 1990 }).ok, true)
  // A paid account has no monthly cap (Infinity).
  assert.equal(M.admitCreate(used, { maxConcurrent: 5, monthlyMinutes: Infinity }, 30 * 60_000, T0, IDLE).ok, true)
})

test('the API is key-authenticated, engine-agnostic and fails closed', () => {
  const src = (f) => readFileSync(ROOT + f, 'utf8')
  const create = src('lib/qbox/actions.ts')
  // Limits, then the paid balance, then the row (reserved slot + minutes), then the engine.
  const order = ['admitCreate(', 'ensureBalance(', "from('qbox_sandboxes').insert", 'engine().create('].map((x) => create.indexOf(x))
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `create order ${order}`)
  // Every command and file operation is charged before it runs (owner: no agent move is free).
  for (const fn of ['execIn', 'writeFileIn', 'readFileIn']) {
    const body = create.slice(create.indexOf(`export async function ${fn}`))
    assert.ok(body.indexOf('chargeOperation(') > 0 && body.indexOf('chargeOperation(') < body.indexOf('engine().'), `${fn} charges first`)
  }
  for (const f of ['app/api/qbox/v1/sandboxes/route.ts', 'app/api/qbox/v1/sandboxes/[id]/route.ts', 'app/api/qbox/v1/sandboxes/[id]/exec/route.ts', 'app/api/qbox/v1/sandboxes/[id]/files/route.ts', 'app/api/qbox/v1/billing/route.ts']) {
    const s = src(f)
    assert.ok(/await authorize\(request\)/.test(s), `${f} checks the API key (and books an x402 payment)`)
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

test('tiers: QBOX_ACCESS=open makes everyone pay; a beta row only raises concurrency there', () => {
  assert.equal(M.isOpenAccess({}), false)
  assert.equal(M.isOpenAccess({ QBOX_ACCESS: 'Open ' }), true)
  assert.equal(M.isOpenAccess({ QBOX_ACCESS: 'invite' }), false)
  const paid = M.tierLimits('paid', { maxConcurrent: 9 })
  assert.equal(paid.tier, 'paid')
  assert.equal(paid.maxConcurrent, 9)
  assert.equal(paid.monthlyMinutes, Infinity)
  assert.equal(paid.maxTimeoutMs, M.QBOX_PAID.maxTimeoutMs)
  assert.equal(M.tierLimits('beta').monthlyMinutes, M.QBOX_BETA.monthlyMinutes)
  assert.deepEqual(M.globalCaps({}), { concurrent: 20, dailyVcpuMinutes: 2000 })
  assert.deepEqual(M.globalCaps({ QBOX_GLOBAL_CONCURRENT: '50', QBOX_DAILY_VCPU_MINUTES: 'x' }), { concurrent: 50, dailyVcpuMinutes: 2000 })
  // Paid sandboxes choose 1/2/4 vCPUs and live up to an hour; the beta stays at 2 vCPUs / 30 min.
  assert.equal(M.parseCreate({ vcpus: 4, timeoutMs: 1e9 }, paid).vcpus, 4)
  assert.equal(M.parseCreate({ timeoutMs: 1e9 }, paid).timeoutMs, M.QBOX_PAID.maxTimeoutMs)
  assert.throws(() => M.parseCreate({ vcpus: 3 }, paid), M.QboxInputError)
  assert.equal(M.networkFor('none', 'open'), 'none')
  assert.equal(M.networkFor('open', 'registries'), 'registries')
  const src = readFileSync(ROOT + 'lib/qbox/store.ts', 'utf8')
  const fn = src.slice(src.indexOf('export async function betaMember'))
  assert.ok(fn.indexOf('data?.disabled') < fn.indexOf('isOpenAccess('), 'a paused account stays paused when Qbox opens')
  assert.ok(fn.indexOf('isOpenAccess(') < fn.indexOf("tierLimits('beta'"), 'open access bills invited accounts too')
})

test('billing: prepaid vCPU-minutes, live sandboxes reserved, operations charged, failures free', () => {
  const r = (start, life, extra = {}) => ({ ...row(start, life), vcpus: 2, ...extra })
  // $1 topped up = 300; a live 2-vCPU sandbox reserving 10 min = 20; an ended 5-min 1-vCPU one = 5; one op = 0.1.
  const topups = [{ vcpu_minutes: 300 }, { vcpu_minutes: -0.1 }]
  const ended = r(-60, 30, { vcpus: 1, status: 'stopped', ended_at: new Date(T0 - 55 * 60_000).toISOString() })
  assert.equal(M.paidBalance(topups, [r(-1, 10), ended], T0), 300 - 0.1 - 20 - 5)
  // Stopped after 10 seconds: billed the minimum minute. Failed to start: not billed.
  const quick = r(-1, 10, { status: 'stopped', ended_at: new Date(T0 - 50_000).toISOString() })
  assert.equal(M.paidBalance([{ vcpu_minutes: 10 }], [quick], T0), 10 - 2)
  assert.equal(M.paidBalance([{ vcpu_minutes: 10 }], [r(-1, 10, { status: 'failed', ended_at: new Date(T0).toISOString() })], T0), 10)
  assert.equal(M.creditsFor(1), 1)
  assert.equal(M.creditsFor(61), 2)
  assert.equal(M.reserveVcpuMinutes(30 * 60_000, 4), 120)
  // The daily budget counts vCPU-minutes of live (reserved) and ended sandboxes since UTC midnight.
  assert.equal(M.vcpuMinutesToday([r(-1, 10), r(-24 * 60, 10)], T0), 20)
})

const X = await import('../lib/qbox/x402.ts')

test('x402: off until a wallet is set; requirements in USDC base units; amount read from the signed payment', () => {
  assert.equal(X.x402Config({}), null)
  assert.equal(X.x402Config({ QBOX_X402_PAY_TO: 'not-an-address' }), null)
  assert.equal(X.x402Config({ QBOX_X402_PAY_TO: '0x' + 'a'.repeat(40), QBOX_X402_NETWORK: 'solana' }), null)
  const cfg = X.x402Config({ QBOX_X402_PAY_TO: '0x' + 'a'.repeat(40) })
  assert.equal(cfg.network, 'base-sepolia')
  assert.equal(cfg.facilitator, 'https://x402.org/facilitator')
  const q = X.requirements(cfg, 5, 'https://quantecode.com/api/qbox/v1/accounts', 'x')
  assert.equal(q.maxAmountRequired, '5000000')
  assert.equal(q.scheme, 'exact')
  assert.equal(q.payTo, cfg.payTo)
  assert.match(q.asset, /^0x[0-9a-fA-F]{40}$/)
  assert.equal(X.parseUsd(null), 5)
  assert.equal(X.parseUsd('20'), 20)
  for (const bad of ['0', '1.5', '101', 'x']) assert.equal(X.parseUsd(bad), null, bad)
  const pay = (value) => ({ x402Version: 1, scheme: 'exact', network: 'base', payload: { signature: '0x', authorization: { value } } })
  assert.equal(X.paidUsd(pay('10000000')), 10)
  for (const bad of ['1500000', '0', '1000000000', 'abc', undefined]) assert.equal(X.paidUsd(pay(bad)), null, String(bad))
  const header = X.encodeHeader(pay('1000000'))
  assert.deepEqual(X.decodePaymentHeader(header), pay('1000000'))
  assert.equal(X.decodePaymentHeader('%%%'), null)
  assert.equal(X.decodePaymentHeader(null), null)
})

const O = await import('../lib/qbox/openapi.ts')

test('agent-facing docs: OpenAPI covers every route, MCP tools are described, llms.txt has the price', () => {
  const doc = O.openApiDocument()
  for (const p of ['/accounts', '/billing', '/sandboxes', '/sandboxes/{id}', '/sandboxes/{id}/exec', '/sandboxes/{id}/files']) assert.ok(doc.paths[p], p)
  for (const [dir, file] of [['accounts', 'route.ts'], ['billing', 'route.ts'], ['mcp', 'route.ts'], ['openapi.json', 'route.ts']]) {
    assert.ok(readFileSync(ROOT + `app/api/qbox/v1/${dir}/${file}`, 'utf8').length > 0, dir)
  }
  const names = O.MCP_TOOLS.map((t) => t.name)
  assert.deepEqual(names, [
    'create_sandbox', 'run_command', 'write_file', 'read_file', 'get_sandbox', 'list_sandboxes', 'stop_sandbox', 'get_balance',
    'search_services', 'get_service', 'wallet_challenge', 'register_wallet', 'publish_service', 'update_service', 'remove_service', 'my_services',
  ])
  for (const t of O.MCP_TOOLS) assert.equal(t.inputSchema.type, 'object', t.name)
  const mcp = readFileSync(ROOT + 'app/api/qbox/v1/mcp/route.ts', 'utf8')
  // Directory tools (no key) run in callPublicTool; every other tool has its own case.
  for (const n of names) assert.ok(O.PUBLIC_TOOLS.has(n) || mcp.includes(`case '${n}'`), `MCP handles ${n}`)
  const txt = O.llmsTxt()
  assert.match(txt, /\$1 = 300 vCPU-minutes/)
  assert.match(txt, /\/accounts\?usd=5/)
  assert.ok(!/qbx_[A-Za-z0-9]{40}/.test(txt + JSON.stringify(doc)), 'no real key in public docs')
})
