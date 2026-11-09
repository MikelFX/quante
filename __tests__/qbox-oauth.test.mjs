// OAuth for the Qbox MCP connector (lib/qbox/oauth.ts): registration, consent request, PKCE code
// exchange, one key per code, discovery metadata.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const O = await import('../lib/qbox/oauth.ts')
const M = await import('../lib/qbox/model.ts')
const secret = O.oauthSecret({ CLERK_SECRET_KEY: 'sk_test_' + 'x'.repeat(40) })
const CB = 'https://claude.ai/api/mcp/auth_callback'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function flow(now = 1_000_000) {
  const reg = O.registerClient(secret, { redirect_uris: [CB], client_name: 'Claude' })
  assert.ok(reg.ok)
  const { verifier, challenge } = pkce()
  const p = O.parseAuthorize(secret, { client_id: reg.clientId, redirect_uri: CB, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'st' })
  assert.ok(p.ok)
  const code = O.issueCode(secret, 'user_1', p.req, now)
  return { reg, verifier, code, form: { grant_type: 'authorization_code', client_id: reg.clientId, code, code_verifier: verifier, redirect_uri: CB } }
}

test('secret: required, fails closed without one', () => {
  assert.equal(O.oauthSecret({}), null)
  assert.equal(O.oauthSecret({ CLERK_SECRET_KEY: 'short' }), null)
  assert.ok(O.oauthSecret({ QBOX_OAUTH_SECRET: 'q'.repeat(32) }))
})

test('registration: https redirects only (http on localhost), signed client id', () => {
  assert.equal(O.registerClient(secret, { redirect_uris: ['http://evil.com/cb'] }).ok, false)
  assert.equal(O.registerClient(secret, { redirect_uris: [] }).ok, false)
  assert.equal(O.registerClient(secret, { redirect_uris: ['javascript:alert(1)'] }).ok, false)
  assert.ok(O.registerClient(secret, { redirect_uris: ['http://localhost:3334/cb'] }).ok)
  const r = O.registerClient(secret, { redirect_uris: [CB], client_name: '<b>Claude</b>' })
  assert.ok(r.ok)
  assert.deepEqual(O.readClient(secret, r.clientId), { redirectUris: [CB], name: 'bClaude/b' })
  const [body, mac] = r.clientId.split('.')
  const forged = Buffer.from(JSON.stringify({ r: ['https://evil.com/cb'], n: 'x' })).toString('base64url')
  assert.equal(O.readClient(secret, `${forged}.${mac}`), null)
  assert.equal(O.readClient(O.oauthSecret({ QBOX_OAUTH_SECRET: 'other'.repeat(8) }), r.clientId), null)
  assert.ok(body)
})

test('authorize: redirect must be the client’s own, PKCE S256 required', () => {
  const r = O.registerClient(secret, { redirect_uris: [CB] })
  const { challenge } = pkce()
  const base = { client_id: r.clientId, redirect_uri: CB, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' }
  assert.equal(O.parseAuthorize(secret, { ...base, redirect_uri: 'https://evil.com/cb' }).ok, false)
  assert.equal(O.parseAuthorize(secret, { ...base, redirect_uri: 'https://evil.com/cb' }).redirect, undefined)
  const plain = O.parseAuthorize(secret, { ...base, code_challenge_method: 'plain' })
  assert.equal(plain.ok, false)
  assert.equal(plain.redirect, CB)
  assert.equal(O.parseAuthorize(secret, { ...base, response_type: 'token' }).ok, false)
  assert.ok(O.parseAuthorize(secret, base).ok)
})

test('token: valid PKCE exchange; wrong verifier, client, redirect or expiry fail', () => {
  const f = flow()
  const ok = O.redeemCode(secret, f.form, 1_000_001)
  assert.ok(ok.ok)
  assert.equal(ok.userId, 'user_1')
  assert.equal(ok.clientName, 'Claude')
  assert.equal(O.redeemCode(secret, { ...f.form, code_verifier: pkce().verifier }, 1_000_001).ok, false)
  assert.equal(O.redeemCode(secret, { ...f.form, redirect_uri: 'https://claude.ai/other' }, 1_000_001).ok, false)
  assert.equal(O.redeemCode(secret, { ...f.form, client_id: O.registerClient(secret, { redirect_uris: [CB], client_name: 'Other' }).clientId }, 1_000_001).ok, false)
  assert.equal(O.redeemCode(secret, f.form, 1_000_000 + O.CODE_TTL_MS + 1).ok, false)
  assert.equal(O.redeemCode(secret, { ...f.form, grant_type: 'refresh_token' }, 1_000_001).error, 'unsupported_grant_type')
  const [body, mac] = f.code.split('.')
  const tampered = `${body}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`
  assert.equal(O.redeemCode(secret, { ...f.form, code: tampered }, 1_000_001).ok, false)
})

test('the access token is a normal Qbox key, fixed per code (so a code works once)', () => {
  const f = flow()
  const r = O.redeemCode(secret, f.form, 1_000_001)
  const key = O.keyForCode(secret, r.nonce)
  assert.equal(M.apiKeyFrom({ get: (n) => (n === 'authorization' ? `Bearer ${key}` : null) }), key)
  assert.equal(O.keyForCode(secret, r.nonce), key)
  assert.notEqual(O.keyForCode(secret, O.redeemCode(secret, flow().form, 1_000_001).nonce), key)
  assert.match(readFileSync(ROOT + 'supabase/migration-qbox-beta.sql', 'utf8'), /key_hash\s+text NOT NULL UNIQUE/)
})

test('discovery metadata and the 401 header point at each other', () => {
  const o = 'https://quantecode.com'
  assert.equal(O.protectedResourceMetadata(o).resource, o + '/qbox/mcp')
  assert.deepEqual(O.protectedResourceMetadata(o).authorization_servers, [o])
  const as = O.authorizationServerMetadata(o)
  assert.equal(as.issuer, o)
  assert.deepEqual(as.code_challenge_methods_supported, ['S256'])
  assert.match(O.wwwAuthenticate(o), /resource_metadata="https:\/\/quantecode\.com\/\.well-known\/oauth-protected-resource\/qbox\/mcp"/)
  const cfg = readFileSync(ROOT + 'next.config.ts', 'utf8')
  assert.match(cfg, /source: '\/qbox\/mcp', destination: '\/api\/qbox\/v1\/connector'/)
  assert.equal(O.requestOrigin(new Request('http://x/qbox/mcp', { headers: { 'x-forwarded-host': 'quantecode.com' } })), o)
  assert.equal(O.requestOrigin(new Request('http://localhost:3000/qbox/mcp')), 'http://localhost:3000')
})
