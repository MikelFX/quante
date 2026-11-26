// Identity provider → Plnolet. Exchanges the code, reads the claims once, keeps only the result
// (over 18 / over 21) and settles the session. The claims themselves are never stored or logged.

import { NextResponse } from 'next/server'
import { ageFromClaims, meets, signState, verifyState } from '@/lib/plnolet/model'
import { providerById } from '@/lib/plnolet/providers'
import { claimsFor } from '@/lib/plnolet/oidc'
import { getSession, settle } from '@/lib/plnolet/store'
import { issueCookie, plnoletOrigin, secretOrThrow } from '@/lib/plnolet/http'

interface State { sid: string; p: 'mojeid' | 'bankid'; v: string; n: string; exp: number }

export async function GET(request: Request) {
  const origin = plnoletOrigin(request)
  const q = new URL(request.url).searchParams
  let secret: string
  try {
    secret = secretOrThrow()
  } catch {
    return NextResponse.redirect(`${origin}/plnolet`, 303)
  }
  const st = verifyState<State>(q.get('state') ?? '', secret, Date.now())
  if (!st) return NextResponse.redirect(`${origin}/plnolet?e=state`, 303)
  const page = (e?: string) => NextResponse.redirect(`${origin}/plnolet/v/${st.sid}${e ? `?e=${e}` : ''}`, 303)
  const code = q.get('code')
  if (!code) return page(q.get('error') === 'access_denied' ? 'cancelled' : 'provider')
  try {
    const p = providerById(process.env, st.p)
    const s = await getSession(st.sid)
    if (!p || !s) return page('provider')
    const claims = await claimsFor(p, { code, redirectUri: `${origin}/api/plnolet/callback`, codeVerifier: st.v })
    const age = ageFromClaims(p.id, claims, Date.now())
    if (!age) return page('unverified') // identity not verified, or no birth date shared: try another way
    const ok = meets(age, s.threshold)
    await settle(s.id, ok, p.id)
    const res = page()
    if (ok) res.cookies.set(issueCookie(s.id, { m: p.id, a18: age.over18, a21: age.over21 }, secret, signState))
    return res
  } catch (e) {
    console.error('[plnolet callback]', e instanceof Error ? e.message : e)
    return page('provider')
  }
}
