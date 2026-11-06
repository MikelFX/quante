// Qbox services — agents sell to agents (lib/qbox/services/model.ts, wallet.ts): parsing, fees,
// wallet proof, gateway header/path rules, public numbers, and that money never goes to our wallet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { secp256k1 } from '@noble/curves/secp256k1'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const M = await import('../lib/qbox/services/model.ts')
const W = await import('../lib/qbox/services/wallet.ts')
const X = await import('../lib/qbox/x402.ts')
const L = await import('../lib/qbox/limits.ts')
const O = await import('../lib/qbox/openapi.ts')
const read = (p) => readFileSync(ROOT + p, 'utf8')

const good = {
  slug: 'pdf-to-markdown', name: 'PDF to Markdown', description: 'Send a PDF URL, get clean Markdown back.',
  priceUsd: '0.01', upstream: { sandboxId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', port: 3000 }, tags: ['PDF', 'markdown'],
}

test('publish: strict slug, price in USDC units, own upstream only', () => {
  const s = M.parseServiceInput(good)
  assert.equal(s.slug, 'pdf-to-markdown')
  assert.equal(s.priceUnits, 10_000)
  assert.deepEqual(s.upstream, { kind: 'sandbox', sandboxId: good.upstream.sandboxId, port: 3000 })
  assert.deepEqual(s.tags, ['pdf', 'markdown'])
  assert.equal(M.parseServiceInput({ ...good, upstream: { url: 'https://api.example.org/v1/?a=1#x' } }).upstream.url, 'https://api.example.org/v1')
  assert.equal(M.parsePriceUnits('100'), 100_000_000)
  assert.equal(M.parsePriceUnits(0.001), 1000)
  for (const bad of [
    { slug: 'ab' }, { slug: 'Qbox-tools' }, { slug: 'qbox' }, { slug: 'admin-panel' }, { slug: 'a--b' }, { slug: '-ab' },
    { priceUsd: '0.0001' }, { priceUsd: '101' }, { priceUsd: '1e3' }, { priceUsd: '0.1234567' }, { priceUsd: -1 },
    { upstream: { url: 'http://api.example.org' } }, { upstream: { url: 'https://localhost' } }, { upstream: { url: 'https://u:p@a.example.org' } },
    { upstream: { url: 'https://a.example.org:8443' } }, { upstream: { sandboxId: 'x', port: 3000 } }, { upstream: { sandboxId: good.upstream.sandboxId, port: 80 } },
    { description: 'short' }, { name: 'ab' }, { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, { tags: ['has space'] }, { inputSchema: [1] },
  ]) {
    assert.throws(() => M.parseServiceInput({ ...good, ...bad }), M.ServiceInputError, JSON.stringify(bad))
  }
  assert.throws(() => M.parseServicePatch({}), M.ServiceInputError)
  assert.throws(() => M.parseServicePatch({ status: 'blocked' }), M.ServiceInputError)
  assert.deepEqual(M.parseServicePatch({ status: 'paused', priceUsd: '0.5' }), { status: 'paused', priceUnits: 500_000 })
})

test('fees: 5 % of the price from the seller balance, never under the floor; $1 to list', () => {
  assert.equal(L.QBOX_EARN.feePercent, 5)
  // $1 call → 5 c → 15 vCPU-minutes at $1 = 300
  assert.equal(M.callFeeVcpuMinutes(1_000_000), 15)
  assert.equal(M.callFeeVcpuMinutes(10_000), 0.15)
  assert.equal(M.callFeeVcpuMinutes(1000), L.QBOX_EARN.minFeeVcpuMinutes)
  assert.equal(M.callFeeVcpuMinutes(100_000_000), 1500)
  assert.equal(M.publishFeeVcpuMinutes(), 300)
  assert.equal(M.usdText(10_000), '0.01')
  assert.equal(M.usdText(100_000_000), '100')
})

test('wallet proof: only the key holder can register an address', () => {
  const priv = secp256k1.utils.randomPrivateKey()
  const address = W.addressOf(secp256k1.getPublicKey(priv, false))
  const issued = new Date().toISOString()
  const msg = M.walletChallenge('agent_abc', address, 'base-sepolia', issued)
  assert.match(msg, /Account: agent_abc/)
  const s = secp256k1.sign(W.personalHash(msg), priv)
  const sig = '0x' + s.toCompactHex() + (27 + s.recovery).toString(16)
  assert.equal(W.recoverSigner(msg, sig), address)
  assert.ok(W.signedBy(msg, sig, address.toUpperCase().replace('0X', '0x')))
  assert.ok(!W.signedBy(msg.replace('agent_abc', 'agent_xyz'), sig, address), 'another account')
  assert.ok(!W.signedBy(msg, sig, '0x' + '1'.repeat(40)), 'another address')
  for (const bad of [null, '', '0x1234', sig.slice(0, -2) + '05', sig + '00']) assert.equal(W.recoverSigner(msg, bad), null)
  // Hardhat's first test account: the address derivation matches the Ethereum one.
  assert.equal(W.addressOf(secp256k1.getPublicKey('ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', false)), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
  const now = Date.now()
  assert.equal(M.freshIssuedAt(issued, now), issued)
  assert.throws(() => M.freshIssuedAt(new Date(now - L.QBOX_EARN.walletChallengeMs - 1000).toISOString(), now), M.ServiceInputError)
  assert.throws(() => M.freshIssuedAt(new Date(now + 5 * 60_000).toISOString(), now), M.ServiceInputError)
  assert.throws(() => M.freshIssuedAt('yesterday', now), M.ServiceInputError)
})

test('gateway: the payment goes to the seller, never to us; one payment = one call', () => {
  const cfg = X.facilitatorConfig({ QBOX_X402_NETWORK: 'base-sepolia' })
  assert.ok(cfg, 'works without our own wallet')
  assert.equal(X.facilitatorConfig({ QBOX_X402_NETWORK: 'solana' }), null)
  const seller = '0x' + 'a'.repeat(40)
  const r = X.requirementsTo(cfg, seller, 10_000, 'https://quantecode.com/api/qbox/v1/x/demo', 'Demo')
  assert.equal(r.payTo, seller)
  assert.equal(r.maxAmountRequired, '10000')
  assert.equal(r.asset, X.usdcAsset('base-sepolia').asset)
  const nonce = '0x' + 'b'.repeat(64)
  const payment = { payload: { authorization: { nonce: nonce.toUpperCase().replace('0X', '0x'), value: '10000' } } }
  assert.equal(M.paymentNonce(payment), nonce)
  assert.equal(M.paymentUnits(payment), 10_000)
  assert.equal(M.paymentNonce({ payload: { authorization: { nonce: '0x12' } } }), null)
  // The gateway settles only after a 2xx answer, reserves the nonce first and books our fee from the seller's balance.
  const g = read('lib/qbox/services/gateway.ts')
  assert.ok(g.indexOf('verifyPayment(') < g.indexOf('startCall(') && g.indexOf('startCall(') < g.indexOf('callUpstream(') && g.indexOf('callUpstream(') < g.indexOf('settleVerified('))
  assert.match(g, /res\.status < 200 \|\| res\.status >= 300/)
  assert.match(g, /requirementsTo\(cfg, s\.wallet/)
  assert.doesNotMatch(g, /QBOX_X402_PAY_TO|x402Config\(/, 'never our own wallet')
  assert.doesNotMatch(read('lib/qbox/services/upstream.ts'), /headers\.location|maxRedirects/, 'redirects are not followed')
  assert.match(read('lib/qbox/services/upstream.ts'), /lookup: safeLookup/)
})

test('gateway: buyer headers are filtered both ways, paths stay inside the service', () => {
  const h = new Headers({ authorization: 'Bearer qbx_x', cookie: 'a=b', 'x-payment': 'p', 'x-api-key': 'k', 'x-forwarded-for': '1.2.3.4', 'content-type': 'application/json', 'x-trace': 't', accept: '*/*' })
  assert.deepEqual(M.forwardRequestHeaders(h), { accept: '*/*', 'content-type': 'application/json', 'x-trace': 't' })
  assert.deepEqual(
    M.forwardResponseHeaders({ 'set-cookie': ['a=1'], 'content-type': 'text/plain', 'transfer-encoding': 'chunked', 'access-control-allow-origin': 'evil', 'x-payment-response': 'fake', 'x-request-id': '1' }),
    { 'content-type': 'text/plain', 'x-request-id': '1' },
  )
  assert.equal(M.upstreamPath(['v1', 'convert'], '?a=1'), '/v1/convert?a=1')
  assert.equal(M.upstreamPath(undefined, ''), '/')
  assert.equal(M.upstreamPath(['a b'], ''), '/a%20b')
  for (const bad of [['..'], ['.'], ['a\\b'], ['x'.repeat(1100)]]) assert.throws(() => M.upstreamPath(bad, ''), M.ServiceInputError)
})

test('directory: public view hides the upstream; numbers count only paid calls', () => {
  const row = { id: 's1', slug: 'demo-svc', user_id: 'agent_1', name: 'Demo', description: 'x'.repeat(30), price_units: '10000', upstream: { kind: 'url', url: 'https://secret.example.org' }, input_schema: null, example: null, tags: ['a'], status: 'live', wallet: '0x' + 'a'.repeat(40), network: 'base-sepolia', created_at: '2026-11-06T00:00:00Z' }
  const pub = M.publicService(row, 'https://quantecode.com/api/qbox/v1')
  assert.equal(pub.endpoint, 'https://quantecode.com/api/qbox/v1/x/demo-svc')
  assert.equal(pub.priceUsd, '0.01')
  assert.ok(!JSON.stringify(pub).includes('secret.example.org'))
  assert.ok(M.matchesQuery(row, 'demo A'))
  assert.ok(!M.matchesQuery(row, 'demo zebra'))
  const calls = [
    { service_id: 's1', seller_id: 'agent_1', payer: '0xB', price_units: 10_000, status: 'paid', created_at: '' },
    { service_id: 's1', seller_id: 'agent_1', payer: '0xb', price_units: '10000', status: 'paid', created_at: '' },
    { service_id: 's2', seller_id: 'agent_2', payer: '0xc', price_units: 2_000_000, status: 'paid', created_at: '' },
    { service_id: 's2', seller_id: 'agent_2', payer: '0xd', price_units: 2_000_000, status: 'upstream_failed', created_at: '' },
    { service_id: 's2', seller_id: 'agent_3', payer: '0xe', price_units: 1_000_000, status: 'settle_failed', created_at: '' },
  ]
  assert.deepEqual(M.marketStats(3, calls), { servicesLive: 3, sellers: 2, buyers: 2, paidCalls: 3, volumeUsd: '2.02' })
  assert.deepEqual(M.statsOf(calls.filter((c) => c.service_id === 's2')), { paidCalls: 1, failedCalls: 1, earnedUsd: '2', buyers: 1 })
})

test('docs and MCP: tools listed, browsing needs no key, prices from QBOX_EARN', () => {
  const names = O.MCP_TOOLS.map((t) => t.name)
  for (const n of ['search_services', 'get_service', 'wallet_challenge', 'register_wallet', 'publish_service', 'update_service', 'remove_service', 'my_services']) assert.ok(names.includes(n), n)
  assert.deepEqual([...O.PUBLIC_TOOLS].sort(), ['get_service', 'search_services'])
  assert.match(O.EARN_LINE, new RegExp(`${L.QBOX_EARN.feePercent} %`))
  const llms = O.llmsTxt()
  assert.match(llms, /## Sell to other agents/)
  assert.match(llms, /## Buy from other agents/)
  const doc = O.openApiDocument()
  for (const p of ['/wallet', '/services', '/services/stats', '/services/{slug}', '/services/{slug}/report', '/x/{slug}/{path}']) assert.ok(doc.paths[p], p)
  const mcp = read('app/api/qbox/v1/mcp/route.ts')
  assert.ok(mcp.indexOf('PUBLIC_TOOLS.has') < mcp.indexOf('caller.c ??= await authorize'))
  // The migration keeps one payment = one call, and the stats function the website imports exists.
  assert.match(read('supabase/migration-qbox-services.sql'), /nonce\s+text NOT NULL UNIQUE/)
  assert.match(read('lib/qbox/services/stats.ts'), /export async function serviceStats\(\)/)
})
