// Plnolet — age verification for e-shops (lib/plnolet). Keys, session input, age from claims,
// signed state, the age pass (passkeys, checked with keys made here) and the privacy rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const M = await import('../lib/plnolet/model.ts')
const W = await import('../lib/plnolet/webauthn.ts')
const P = await import('../lib/plnolet/providers.ts')
const D = await import('../lib/domains.ts')
const H = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null })
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('API keys: test and live prefixes, stored as a hash, parsed strictly', () => {
  for (const mode of ['test', 'live']) {
    const k = M.newKey(mode)
    assert.match(k.key, new RegExp(`^plt_${mode}_[A-Za-z0-9]{40}$`))
    assert.equal(k.hash, createHash('sha256').update(k.key).digest('hex'))
    assert.deepEqual(M.keyFrom(H({ authorization: `Bearer ${k.key}` })), { key: k.key, mode })
    assert.ok(k.key.startsWith(k.prefix))
  }
  for (const bad of ['', 'Bearer plt_test_short', 'Bearer qbx_' + 'a'.repeat(40), `Basic ${M.newKey('test').key}`, 'Bearer plt_prod_' + 'a'.repeat(40)]) {
    assert.equal(M.keyFrom(H({ authorization: bad })), null, bad)
  }
})

test('merchant domains are normalised and validated', () => {
  assert.equal(M.normalizeDomain('https://www.Shop.cz/kosik'), 'shop.cz')
  assert.equal(M.normalizeDomain('eshop.example.co.uk:443'), 'eshop.example.co.uk')
  assert.equal(M.normalizeDomain('not a domain'), null)
  assert.deepEqual(M.parseMerchant({ name: '  Vape  Dům ', domains: 'vapedum.cz, www.vapedum.cz https://shop.vapedum.cz' }), { name: 'Vape Dům', domains: ['vapedum.cz', 'shop.vapedum.cz'] })
  assert.throws(() => M.parseMerchant({ name: '' }), M.PlnoletInputError)
  assert.throws(() => M.parseMerchant({ name: 'x', domains: ['ok.cz', 'bad domain'] }), M.PlnoletInputError)
  assert.ok(M.hostAllowed('pokladna.shop.cz', ['shop.cz']))
  assert.ok(!M.hostAllowed('evilshop.cz', ['shop.cz']))
  assert.ok(!M.hostAllowed('shop.cz.evil.com', ['shop.cz']))
})

test('a session returns only to the merchant\'s own https domain (no open redirect)', () => {
  const ok = M.parseSession({ min_age: 21, return_url: 'https://www.shop.cz/pokladna?x=1#top', reference: 'obj-1' }, 'live', ['shop.cz'])
  assert.deepEqual(ok, { threshold: 21, returnUrl: 'https://www.shop.cz/pokladna?x=1', reference: 'obj-1' })
  assert.equal(M.parseSession({ return_url: 'https://shop.cz/' }, 'live', ['shop.cz']).threshold, 18)
  const bad = [
    [{ min_age: 15, return_url: 'https://shop.cz/' }, 'live'],
    [{ return_url: 'https://evil.cz/' }, 'live'],
    [{ return_url: 'http://shop.cz/' }, 'live'],
    [{ return_url: 'javascript:alert(1)' }, 'live'],
    [{ return_url: 'https://user:pw@shop.cz/' }, 'live'],
    [{ return_url: 'http://localhost:3000/' }, 'live'],
    [{ return_url: 'https://shop.cz/', reference: 'x'.repeat(121) }, 'live'],
    [{ return_url: 'https://shop.cz/', reference: 'a\nb' }, 'live'],
  ]
  for (const [b, mode] of bad) assert.throws(() => M.parseSession(b, mode, ['shop.cz']), M.PlnoletInputError, JSON.stringify(b))
  assert.equal(M.parseSession({ return_url: 'http://localhost:3000/ok' }, 'test', []).returnUrl, 'http://localhost:3000/ok')
})

test('session ids, expiry and the way back', () => {
  const id = M.newSessionId()
  assert.ok(M.isSessionId(id))
  assert.ok(!M.isSessionId('ses_../../etc'))
  const now = Date.parse('2026-11-25T12:00:00Z')
  assert.equal(M.effectiveStatus({ status: 'pending', expires_at: '2026-11-25T11:59:00Z' }, now), 'expired')
  assert.equal(M.effectiveStatus({ status: 'verified', expires_at: '2026-11-25T11:59:00Z' }, now), 'verified')
  const back = new URL(M.returnTo('https://shop.cz/k?a=1', id, 'verified'))
  assert.equal(back.searchParams.get('plnolet_session'), id)
  assert.equal(back.searchParams.get('a'), '1')
})

test('age from a verified birth date, never from an unverified account', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')
  assert.equal(M.ageOn('2008-11-25', now), 18)
  assert.equal(M.ageOn('2008-11-26', now), 17)
  assert.equal(M.ageOn('2008-02-30', now), null)
  assert.equal(M.ageOn('25.11.2008', now), null)
  assert.deepEqual(M.ageFromClaims('mojeid', { mojeid_valid: true, birthdate: '2005-11-25' }, now), { over18: true, over21: true })
  assert.deepEqual(M.ageFromClaims('mojeid', { mojeid_valid: true, birthdate: '2006-01-01' }, now), { over18: true, over21: false })
  assert.equal(M.ageFromClaims('mojeid', { mojeid_valid: false, birthdate: '1990-01-01' }, now), null)
  assert.equal(M.ageFromClaims('mojeid', { birthdate: '1990-01-01' }, now), null)
  assert.deepEqual(M.ageFromClaims('mojeid', { mojeid_valid: true, adult: true }, now), { over18: true, over21: false })
  assert.deepEqual(M.ageFromClaims('bankid', { birthdate: '2010-05-05' }, now), { over18: false, over21: false })
  assert.equal(M.ageFromClaims('bankid', {}, now), null)
  assert.ok(M.meets({ over18: true, over21: false }, 18))
  assert.ok(!M.meets({ over18: true, over21: false }, 21))
})

test('signed state: tamper, expiry and secret are all checked', () => {
  const now = Date.now()
  const t = M.signState({ sid: 'ses_x', exp: now + 1000 }, 's'.repeat(40))
  assert.equal(M.verifyState(t, 's'.repeat(40), now).sid, 'ses_x')
  assert.equal(M.verifyState(t, 'z'.repeat(40), now), null)
  assert.equal(M.verifyState(t, 's'.repeat(40), now + 2000), null)
  const [b, sig] = t.split('.')
  const forged = Buffer.from(JSON.stringify({ sid: 'ses_y', exp: now + 1000 })).toString('base64url')
  assert.equal(M.verifyState(`${forged}.${sig}`, 's'.repeat(40), now), null)
  assert.equal(M.verifyState(`${b}.${sig}.x`, 's'.repeat(40), now), null)
  assert.equal(M.plnoletSecret({}), null)
  assert.equal(M.plnoletSecret({ PLNOLET_SECRET: 'short' , CLERK_SECRET_KEY: 'sk' }).length, 64)
  assert.equal(M.plnoletSecret({ PLNOLET_SECRET: 'p'.repeat(32) }), 'p'.repeat(32))
})

test('age pass: answers only within its age, mode and validity', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')
  const pass = { over18: true, over21: false, mode: 'live', expires_at: M.passExpiry(now - 86_400_000), revoked_at: null }
  assert.equal(M.passProblem(pass, { threshold: 18, mode: 'live' }, now), null)
  assert.equal(M.passProblem(pass, { threshold: 21, mode: 'live' }, now), 'age')
  assert.equal(M.passProblem(pass, { threshold: 18, mode: 'test' }, now), 'mode')
  assert.equal(M.passProblem({ ...pass, revoked_at: '2026-01-01' }, { threshold: 18, mode: 'live' }, now), 'revoked')
  assert.equal(M.passProblem(pass, { threshold: 18, mode: 'live' }, now + 366 * 86_400_000), 'expired')
  assert.ok(!M.canIssuePass('pass'))
  assert.ok(M.canIssuePass('bankid') && M.canIssuePass('mojeid'))
})

// ── WebAuthn with real keys ────────────────────────────────────────────────

const ORIGIN = 'https://quantecode.com'
const RP = 'quantecode.com'
const rpHash = createHash('sha256').update(RP).digest()
const b64u = (b) => Buffer.from(b).toString('base64url')

function authData({ flags = 0x05, count = 0, credId = null } = {}) {
  const head = Buffer.alloc(37)
  rpHash.copy(head, 0)
  head[32] = flags | (credId ? 0x40 : 0)
  head.writeUInt32BE(count, 33)
  if (!credId) return head
  const len = Buffer.alloc(2)
  len.writeUInt16BE(credId.length)
  return Buffer.concat([head, Buffer.alloc(16), len, credId])
}
const client = (type, challenge, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))

for (const [label, alg, make, dsa] of [
  ['ES256', -7, () => generateKeyPairSync('ec', { namedCurve: 'P-256' }), 'der'],
  ['RS256', -257, () => generateKeyPairSync('rsa', { modulusLength: 2048 }), undefined],
]) {
  test(`passkey register + assert (${label})`, async () => {
    const { publicKey, privateKey } = make()
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    const credId = Buffer.from('credential-' + label)
    const reg = await W.verifyRegistration({
      credentialId: b64u(credId), publicKey: b64u(spki), alg,
      clientDataJSON: b64u(client('webauthn.create', 'CH1')), authenticatorData: b64u(authData({ credId })),
    }, { challenge: 'CH1', origin: ORIGIN, rpId: RP })
    assert.equal(reg.credentialId, b64u(credId))

    const ad = authData({ count: 0 })
    const cd = client('webauthn.get', 'CH2')
    const signed = Buffer.concat([ad, createHash('sha256').update(cd).digest()])
    const sig = sign('sha256', signed, dsa ? { key: privateKey, dsaEncoding: dsa } : privateKey)
    const body = { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig) }
    const stored = { publicKey: reg.publicKey, alg, signCount: 0 }
    await W.verifyAssertion(body, stored, { challenge: 'CH2', origin: ORIGIN, rpId: RP })

    // Wrong challenge, wrong origin, another site's RP id, a changed signature: all refused.
    await assert.rejects(W.verifyAssertion(body, stored, { challenge: 'CH3', origin: ORIGIN, rpId: RP }), W.WebAuthnError)
    await assert.rejects(W.verifyAssertion(body, stored, { challenge: 'CH2', origin: 'https://evil.cz', rpId: RP }), W.WebAuthnError)
    await assert.rejects(W.verifyAssertion(body, stored, { challenge: 'CH2', origin: ORIGIN, rpId: 'evil.cz' }), W.WebAuthnError)
    const bad = Buffer.from(sig); bad[bad.length - 1] ^= 1
    await assert.rejects(W.verifyAssertion({ ...body, signature: b64u(bad) }, stored, { challenge: 'CH2', origin: ORIGIN, rpId: RP }), W.WebAuthnError)
    // A registration ceremony's data cannot be replayed as an assertion.
    await assert.rejects(W.verifyAssertion({ ...body, clientDataJSON: b64u(client('webauthn.create', 'CH2')) }, stored, { challenge: 'CH2', origin: ORIGIN, rpId: RP }), W.WebAuthnError)
  })
}

test('passkey registration refuses a credential id that is not in the authenticator data, and no user presence', async () => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const spki = b64u(publicKey.export({ type: 'spki', format: 'der' }))
  const base = { publicKey: spki, alg: -7, clientDataJSON: b64u(client('webauthn.create', 'C')) }
  const exp = { challenge: 'C', origin: ORIGIN, rpId: RP }
  await assert.rejects(W.verifyRegistration({ ...base, credentialId: b64u('other'), authenticatorData: b64u(authData({ credId: Buffer.from('mine') })) }, exp), W.WebAuthnError)
  await assert.rejects(W.verifyRegistration({ ...base, credentialId: b64u('mine'), authenticatorData: b64u(authData({ flags: 0x04, credId: Buffer.from('mine') })) }, exp), W.WebAuthnError)
  await assert.rejects(W.verifyRegistration({ ...base, alg: -8, credentialId: b64u('mine'), authenticatorData: b64u(authData({ credId: Buffer.from('mine') })) }, exp), W.WebAuthnError)
})

test('a sign counter that goes backwards means a cloned authenticator', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const ad = authData({ count: 5 })
  const cd = client('webauthn.get', 'X')
  const sig = sign('sha256', Buffer.concat([ad, createHash('sha256').update(cd).digest()]), { key: privateKey, dsaEncoding: 'der' })
  const stored = { publicKey: b64u(publicKey.export({ type: 'spki', format: 'der' })), alg: -7 }
  const body = { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig) }
  const exp = { challenge: 'X', origin: ORIGIN, rpId: RP }
  assert.equal((await W.verifyAssertion(body, { ...stored, signCount: 4 }, exp)).signCount, 5)
  await assert.rejects(W.verifyAssertion(body, { ...stored, signCount: 5 }, exp), W.WebAuthnError)
})

// ── providers, routes, privacy ─────────────────────────────────────────────

test('identity providers are on only with credentials; live needs PLNOLET_LIVE and a provider', () => {
  assert.deepEqual(P.providers({}), [])
  assert.equal(P.liveAvailable({ PLNOLET_LIVE: '1' }), false)
  const env = { PLNOLET_MOJEID_CLIENT_ID: 'a', PLNOLET_MOJEID_CLIENT_SECRET: 'b', PLNOLET_LIVE: '1' }
  assert.deepEqual(P.providers(env).map((p) => p.id), ['mojeid'])
  assert.equal(P.liveAvailable(env), true)
  assert.equal(P.providers({ ...env, PLNOLET_MOJEID_ISSUER: 'http://insecure.example/' }).length, 0)
  assert.equal(P.providerById(env, 'bankid'), null)
})

test('Plnolet pages live on the app host and are Czech', () => {
  for (const p of ['/plnolet', '/plnolet/v/ses_x', '/plnolet/ucet']) {
    assert.equal(D.pageLang(p), 'cs', p)
  }
  assert.ok(D.APP_PATHS.includes('/plnolet') && D.APP_PATHS.includes('/plnolet/:path*'))
  assert.match(read('proxy.ts'), /'\/api\/plnolet\/v1\/\(\.\*\)'/)
})

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

test('no shopper identity is stored: no name, birth date or document column, claims never persisted', () => {
  const sql = read('supabase/migration-plnolet.sql').toLowerCase()
  for (const col of ['birthdate', 'birth_date', 'given_name', 'family_name', 'document', 'email']) {
    assert.ok(!new RegExp(`^\\s+${col}\\b`, 'm').test(sql), col)
  }
  const cb = read('app/api/plnolet/callback/route.ts')
  assert.ok(!/insert\(|claims\)/.test(cb.replace(/ageFromClaims\(p\.id, claims/, '')), 'callback must not store or log claims')
  assert.ok(!/console\.\w+\([^)]*claims/.test(cb))
})

test('the shopper pages never test against real identities, and prices live in one file', () => {
  const page = read('app/plnolet/v/[id]/page.tsx')
  assert.match(page, /s\.mode === 'live'/)
  const start = read('app/api/plnolet/s/[id]/start/[provider]/route.ts')
  assert.match(start, /s\.mode !== 'live'/)
  const files = walk(join(ROOT, 'app/plnolet')).filter((f) => /\.tsx?$/.test(f))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.ok(!/\b(249|690|1\s?990)\b/.test(src), `price typed in ${f}`)
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(src.replace(/href="#|#(jak|cenik|api)\b/g, '')), `hex colour in ${f}`)
  }
  const css = read('app/plnolet/plnolet.css')
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'plnolet.css uses tokens only')
  for (const sel of css.match(/^[^@\s/{}][^{]*\{/gm) ?? []) {
    if (/^(from|to)\b/.test(sel.trim()) || /^:root\[data-motion/.test(sel)) continue
    assert.match(sel, /\.pn\b/, sel)
  }
  for (const k of css.match(/@keyframes\s+([\w-]+)/g) ?? []) assert.match(k, /pn-/)
})

test('the widget only accepts the verification window\'s own message', () => {
  const js = read('public/plnolet/widget.js')
  assert.match(js, /ev\.origin !== target\.origin/)
  assert.match(js, /ev\.data\.session !== session/)
  const client = read('app/plnolet/v/[id]/VerifyClient.tsx')
  assert.match(client, /postMessage\([^)]*p\.backOrigin\)/)
})
