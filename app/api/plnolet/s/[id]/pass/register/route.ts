// Plnolet shopper page: save an age pass right after a successful check, in the same browser
// (the signed pn_issue cookie set by that check). One pass per session.
//   POST { step: "options" }  → { challenge, token, rpId, userId }
//   POST { step: "verify", token, credentialId, publicKey, alg, clientDataJSON, authenticatorData }

import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { canIssuePass, isSessionId, passExpiry, signState, verifyState, type Method } from '@/lib/plnolet/model'
import { verifyRegistration, WebAuthnError } from '@/lib/plnolet/webauthn'
import { getSession } from '@/lib/plnolet/store'
import { ISSUE_COOKIE, handle, issueGrant, pageError, plnoletOrigin, readJson, rpIdOf, secretOrThrow } from '@/lib/plnolet/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isSessionId(id)) return pageError(404, 'Odkaz na ověření neexistuje.')
    const body = await readJson(request).catch(() => null)
    if (!body) return pageError(400, 'Neplatný požadavek.')
    const s = await getSession(id)
    const secret = secretOrThrow()
    const grant = issueGrant(request, id, secret)
    if (!s || s.status !== 'verified' || s.pass_issued || !grant || !canIssuePass(grant.m as Method) || grant.m !== s.method) {
      return pageError(403, 'Věkový pas lze uložit jen hned po ověření, v tomtéž prohlížeči.')
    }
    const origin = plnoletOrigin(request)
    const rpId = rpIdOf(origin)

    if (body.step === 'options') {
      const challenge = randomBytes(32).toString('base64url')
      const token = signState({ sid: id, k: 'create', ch: challenge, exp: Date.now() + 5 * 60_000 }, secret)
      // The passkey's user handle is random: it names nobody and links nothing.
      return NextResponse.json({ ok: true, challenge, token, rpId, userId: randomBytes(16).toString('base64url') })
    }

    const st = verifyState<{ sid: string; k: string; ch: string; exp: number }>(String(body.token ?? ''), secret, Date.now())
    if (!st || st.sid !== id || st.k !== 'create') return pageError(400, 'Výzva vypršela. Zkuste to prosím znovu.')
    let reg
    try {
      reg = await verifyRegistration(body, { challenge: st.ch, origin, rpId })
    } catch (e) {
      if (e instanceof WebAuthnError) return pageError(400, 'Věkový pas se nepodařilo uložit.')
      throw e
    }
    // Mark the session first: only one pass per verification, even with parallel requests.
    const { data: claimed } = await supabaseAdmin
      .from('plnolet_sessions').update({ pass_issued: true }).eq('id', id).eq('pass_issued', false).select('id')
    if (!claimed?.length) return pageError(409, 'Věkový pas už je uložený.')
    const now = Date.now()
    const { error } = await supabaseAdmin.from('plnolet_passes').insert({
      credential_id: reg.credentialId,
      public_key: reg.publicKey,
      alg: reg.alg,
      mode: s.mode,
      over18: grant.a18,
      over21: grant.a21,
      method: grant.m,
      verified_at: new Date(now).toISOString(),
      expires_at: passExpiry(now),
    })
    if (error) {
      await supabaseAdmin.from('plnolet_sessions').update({ pass_issued: false }).eq('id', id)
      return pageError(409, 'Věkový pas se nepodařilo uložit.')
    }
    const res = NextResponse.json({ ok: true, expiresAt: passExpiry(now) })
    res.cookies.set({ name: ISSUE_COOKIE, value: '', path: '/api/plnolet', maxAge: 0 })
    return res
  } catch (e) {
    return handle(e)
  }
}
