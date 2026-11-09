// OAuth 2.1 for the Qbox MCP connector (owner 2026-11-09: "add the Qbox connector in Claude with
// this link" must work — claude.ai's custom connectors take only a URL, never a header).
//
// Flow (MCP authorization spec): the connector URL (/qbox/mcp) answers 401 + WWW-Authenticate →
// protected-resource metadata → authorization-server metadata → dynamic client registration →
// /qbox/authorize (signed in with Clerk, the person allows it) → code → /api/qbox/oauth/token
// (PKCE S256) → the access token IS a normal Qbox API key (qbx_…), so every existing check, limit
// and bill applies unchanged and the key shows up (and can be revoked) on /qbox.
//
// Stateless: client ids and codes are HMAC-signed blobs, nothing is stored until the token is
// issued. A code works once: the key it turns into is derived from the code's nonce and
// qbox_api_keys.key_hash is UNIQUE, so a second exchange fails on insert.
//
// Pure apart from node:crypto (tested in __tests__/qbox-oauth.test.mjs).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const CONNECTOR_PATH = '/qbox/mcp'
export const AUTHORIZE_PATH = '/qbox/authorize'
export const TOKEN_PATH = '/api/qbox/oauth/token'
export const REGISTER_PATH = '/api/qbox/oauth/register'
export const CODE_TTL_MS = 10 * 60_000
export const OAUTH_SCOPE = 'qbox'

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

/** Signing key: QBOX_OAUTH_SECRET, else derived from the Clerk secret. null = OAuth is off (fail closed). */
export function oauthSecret(env: Record<string, string | undefined>): Buffer | null {
  const base = env.QBOX_OAUTH_SECRET?.trim() || env.CLERK_SECRET_KEY?.trim()
  if (!base || base.length < 16) return null
  return createHash('sha256').update('qbox-oauth:v1:' + base).digest()
}

function sign(secret: Buffer, kind: string, payload: unknown): string {
  const body = b64(JSON.stringify(payload))
  const mac = createHmac('sha256', secret).update(kind + '.' + body).digest('base64url')
  return `${body}.${mac}`
}

function verify<T>(secret: Buffer, kind: string, token: unknown): T | null {
  if (typeof token !== 'string' || token.length > 4000) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  const want = createHmac('sha256', secret).update(kind + '.' + body).digest()
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    return JSON.parse(unb64(body)) as T
  } catch {
    return null
  }
}

/** Where an OAuth client may be sent back to: https anywhere, http only on this machine (local MCP clients). */
export function validRedirectUri(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 500) return false
  let url: URL
  try {
    url = new URL(u)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export interface OAuthClient { redirectUris: string[]; name: string }

/** Dynamic client registration (RFC 7591) → a signed client id that carries its own redirect URIs. */
export function registerClient(secret: Buffer, body: unknown): { ok: true; clientId: string; client: OAuthClient } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : []
  if (!uris.length || uris.length > 5 || !uris.every(validRedirectUri)) return { ok: false, error: 'redirect_uris must be 1–5 https URLs (http only for localhost).' }
  const rawName = typeof b.client_name === 'string' ? b.client_name : ''
  const name = rawName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'MCP client'
  const client: OAuthClient = { redirectUris: [...new Set(uris as string[])], name }
  return { ok: true, clientId: sign(secret, 'client', { r: client.redirectUris, n: client.name }), client }
}

export function readClient(secret: Buffer, clientId: unknown): OAuthClient | null {
  const p = verify<{ r?: unknown; n?: unknown }>(secret, 'client', clientId)
  if (!p || !Array.isArray(p.r) || !p.r.every(validRedirectUri) || typeof p.n !== 'string') return null
  return { redirectUris: p.r as string[], name: p.n }
}

export interface AuthorizeRequest { clientId: string; client: OAuthClient; redirectUri: string; state: string; codeChallenge: string }

/**
 * Checks /qbox/authorize's query. `redirect` = the error may be sent back to the client (its
 * redirect URI is known to be its own); otherwise it must be shown on our page.
 */
export function parseAuthorize(secret: Buffer, q: Record<string, string | undefined>):
  { ok: true; req: AuthorizeRequest } | { ok: false; error: string; redirect?: string; state?: string } {
  const client = readClient(secret, q.client_id)
  if (!client) return { ok: false, error: 'Unknown client. Remove the connector and add it again.' }
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : '')
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, error: 'This redirect address does not belong to the client.' }
  const state = (q.state ?? '').slice(0, 500)
  if (q.response_type !== 'code') return { ok: false, error: 'unsupported_response_type', redirect: redirectUri, state }
  const ch = q.code_challenge ?? ''
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(ch)) return { ok: false, error: 'invalid_request', redirect: redirectUri, state }
  return { ok: true, req: { clientId: q.client_id!, client, redirectUri, state, codeChallenge: ch } }
}

interface CodePayload { u: string; c: string; r: string; ch: string; e: number; n: string }

const clientRef = (clientId: string) => createHash('sha256').update(clientId).digest('base64url').slice(0, 22)

export function issueCode(secret: Buffer, userId: string, a: AuthorizeRequest, now: number): string {
  const p: CodePayload = { u: userId, c: clientRef(a.clientId), r: a.redirectUri, ch: a.codeChallenge, e: now + CODE_TTL_MS, n: randomBytes(18).toString('base64url') }
  return sign(secret, 'code', p)
}

/** The redirect back to the client with ?code= (or ?error=) and the state it sent. */
export function clientRedirect(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  return url.toString()
}

/** Checks a token request (authorization_code + PKCE). Returns the user and the code's nonce. */
export function redeemCode(secret: Buffer, form: Record<string, string | undefined>, now: number):
  { ok: true; userId: string; nonce: string; clientName: string } | { ok: false; error: string; description: string } {
  if (form.grant_type !== 'authorization_code') return { ok: false, error: 'unsupported_grant_type', description: 'Only authorization_code is supported.' }
  const client = readClient(secret, form.client_id)
  if (!client) return { ok: false, error: 'invalid_client', description: 'Unknown client.' }
  const p = verify<CodePayload>(secret, 'code', form.code)
  if (!p || typeof p.e !== 'number' || p.e < now) return { ok: false, error: 'invalid_grant', description: 'The code is invalid or expired.' }
  if (p.c !== clientRef(form.client_id!)) return { ok: false, error: 'invalid_grant', description: 'The code was issued to another client.' }
  if (form.redirect_uri !== undefined && form.redirect_uri !== p.r) return { ok: false, error: 'invalid_grant', description: 'redirect_uri does not match.' }
  const verifier = form.code_verifier ?? ''
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return { ok: false, error: 'invalid_grant', description: 'code_verifier is missing or malformed.' }
  if (createHash('sha256').update(verifier).digest('base64url') !== p.ch) return { ok: false, error: 'invalid_grant', description: 'PKCE check failed.' }
  return { ok: true, userId: p.u, nonce: p.n, clientName: client.name }
}

const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** The Qbox API key a code turns into: same shape as newApiKey(), fixed per code (one use). */
export function keyForCode(secret: Buffer, nonce: string): string {
  let body = ''
  let block = 0
  while (body.length < 40) {
    for (const byte of createHmac('sha256', secret).update(`key:${nonce}:${block++}`).digest()) {
      if (byte < 248) body += KEY_ALPHABET[byte % 62] // 248 = 4 × 62: no bias
      if (body.length === 40) break
    }
  }
  return 'qbx_' + body
}

/** Name of the key on /qbox: one per connected client (a new connection replaces the old key). */
export const connectorKeyName = (clientName: string) => `${clientName} · connector`.slice(0, 60)

export function protectedResourceMetadata(origin: string) {
  return {
    resource: origin + CONNECTOR_PATH,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Qbox',
    resource_documentation: origin + '/qbox',
  }
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: origin + AUTHORIZE_PATH,
    token_endpoint: origin + TOKEN_PATH,
    registration_endpoint: origin + REGISTER_PATH,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: origin + '/qbox',
  }
}

/** The header that tells an MCP client where to log in. */
export const wwwAuthenticate = (origin: string) =>
  `Bearer realm="qbox", resource_metadata="${origin}/.well-known/oauth-protected-resource${CONNECTOR_PATH}"`

/** https origin of the request (Vercel: x-forwarded-host); http only for localhost. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  return `${local ? url.protocol.replace(':', '') : 'https'}://${host}`
}
