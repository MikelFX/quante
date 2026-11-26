// OpenID Connect round-trip for Plnolet (authorization code + PKCE). Server-only. The issuer comes
// from lib/plnolet/providers.ts (env), so every request goes to a fixed, configured host.

import type { Provider } from './providers'

interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

const cache = new Map<string, { at: number; doc: Discovery }>()

function sameHost(url: string, issuer: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.host === new URL(issuer).host
  } catch {
    return false
  }
}

export async function discover(p: Provider): Promise<Discovery> {
  const hit = cache.get(p.issuer)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.doc
  const res = await fetch(new URL('.well-known/openid-configuration', p.issuer), { signal: AbortSignal.timeout(6000), redirect: 'error' })
  if (!res.ok) throw new Error(`discovery ${res.status}`)
  const j = (await res.json()) as Partial<Discovery>
  const doc = {
    authorization_endpoint: String(j.authorization_endpoint ?? ''),
    token_endpoint: String(j.token_endpoint ?? ''),
    userinfo_endpoint: String(j.userinfo_endpoint ?? ''),
  }
  // Every endpoint must sit on the issuer's own host: a tampered document cannot send codes elsewhere.
  if (!Object.values(doc).every((u) => sameHost(u, p.issuer))) throw new Error('discovery endpoints off the issuer host')
  cache.set(p.issuer, { at: Date.now(), doc })
  return doc
}

export async function authorizeUrl(p: Provider, o: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): Promise<string> {
  const d = await discover(p)
  const u = new URL(d.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('redirect_uri', o.redirectUri)
  u.searchParams.set('scope', p.scope)
  u.searchParams.set('state', o.state)
  u.searchParams.set('nonce', o.nonce)
  u.searchParams.set('code_challenge', o.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('prompt', 'login')
  if (p.claims) u.searchParams.set('claims', p.claims)
  return u.toString()
}

/** Code → access token → userinfo claims. Nothing is stored; the caller keeps only the age result. */
export async function claimsFor(p: Provider, o: { code: string; redirectUri: string; codeVerifier: string }): Promise<Record<string, unknown>> {
  const d = await discover(p)
  const tok = await fetch(d.token_endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(p.clientId)}:${encodeURIComponent(p.clientSecret)}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: o.code, redirect_uri: o.redirectUri, code_verifier: o.codeVerifier }),
  })
  if (!tok.ok) throw new Error(`token ${tok.status}`)
  const t = (await tok.json()) as { access_token?: string }
  if (!t.access_token) throw new Error('no access token')
  const ui = await fetch(d.userinfo_endpoint, {
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' },
  })
  if (!ui.ok) throw new Error(`userinfo ${ui.status}`)
  const type = ui.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new Error('userinfo is not JSON (signed userinfo is not supported)')
  return (await ui.json()) as Record<string, unknown>
}
