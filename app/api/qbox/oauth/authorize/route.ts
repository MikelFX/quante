// The consent form on /qbox/authorize posts here (signed-in Clerk session, same-origin form; the
// proxy's CSRF check applies). Allow → back to the MCP client with a one-time code; Deny → with
// error=access_denied. lib/qbox/oauth.ts.
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { QboxNotSetUpError, betaMember } from '@/lib/qbox/store'
import { AUTHORIZE_PATH, clientRedirect, issueCode, oauthSecret, parseAuthorize, requestOrigin } from '@/lib/qbox/oauth'

export async function POST(request: Request) {
  const secret = oauthSecret(process.env)
  if (!secret) return NextResponse.json({ error: 'Qbox sign-in is not set up.' }, { status: 503 })
  const form = Object.fromEntries(new URLSearchParams((await request.text().catch(() => '')).slice(0, 20_000)))
  const origin = requestOrigin(request)
  const back = `${origin}${AUTHORIZE_PATH}?${new URLSearchParams(Object.entries(form).filter(([k]) => k !== 'decision'))}`
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(`${origin}/login?redirect_url=${encodeURIComponent(back)}`, 303)

  const p = parseAuthorize(secret, form)
  if (!p.ok) {
    if (p.redirect) return NextResponse.redirect(clientRedirect(p.redirect, { error: p.error, state: p.state ?? '', iss: origin }), 303)
    return NextResponse.redirect(back, 303) // the page shows the error
  }
  if (form.decision !== 'allow') {
    return NextResponse.redirect(clientRedirect(p.req.redirectUri, { error: 'access_denied', state: p.req.state, iss: origin }), 303)
  }
  let member
  try {
    member = await betaMember(userId)
  } catch (e) {
    if (!(e instanceof QboxNotSetUpError)) throw e
    member = null
  }
  if (!member) return NextResponse.redirect(back, 303) // the page explains there is no access
  const code = issueCode(secret, userId, p.req, Date.now())
  return NextResponse.redirect(clientRedirect(p.req.redirectUri, { code, state: p.req.state, iss: origin }), 303)
}
