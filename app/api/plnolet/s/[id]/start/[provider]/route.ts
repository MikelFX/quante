// Plnolet shopper page → identity provider (mojeID, Bank iD). GET redirects to the provider with a
// signed state (session id + PKCE verifier + nonce), so the callback needs no storage.

import { NextResponse } from 'next/server'
import { isSessionId, pkce, signState } from '@/lib/plnolet/model'
import { providerById } from '@/lib/plnolet/providers'
import { authorizeUrl } from '@/lib/plnolet/oidc'
import { getSession, takeAttempt } from '@/lib/plnolet/store'
import { plnoletOrigin, secretOrThrow } from '@/lib/plnolet/http'
import { randomBytes } from 'node:crypto'

export async function GET(request: Request, { params }: { params: Promise<{ id: string; provider: string }> }) {
  const { id, provider } = await params
  const origin = plnoletOrigin(request)
  const back = (e: string) => NextResponse.redirect(`${origin}/plnolet/v/${isSessionId(id) ? id : ''}?e=${e}`, 303)
  try {
    if (!isSessionId(id)) return back('missing')
    const p = providerById(process.env, provider)
    if (!p) return back('method')
    const s = await getSession(id)
    if (!s) return back('missing')
    if (s.mode !== 'live' && process.env.PLNOLET_PROVIDERS_IN_TEST !== '1') return back('method')
    if (!(await takeAttempt(s))) return back('closed')
    const { verifier, challenge } = pkce()
    const nonce = randomBytes(16).toString('base64url')
    const state = signState({ sid: id, p: p.id, v: verifier, n: nonce, exp: Date.now() + 15 * 60_000 }, secretOrThrow())
    const url = await authorizeUrl(p, { redirectUri: `${origin}/api/plnolet/callback`, state, nonce, codeChallenge: challenge })
    return NextResponse.redirect(url, 303)
  } catch (e) {
    console.error('[plnolet start]', e)
    return back('provider')
  }
}
