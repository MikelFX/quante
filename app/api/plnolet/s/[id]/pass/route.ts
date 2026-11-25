// Plnolet shopper page: prove the age with an age pass (a passkey saved after an earlier check).
//   POST { step: "options" }                    → { challenge, token, rpId }
//   POST { step: "verify", token, credentialId, clientDataJSON, authenticatorData, signature }
// The pass knows only "over 18 / over 21" and when it was issued — not who the person is.

import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSessionId, passProblem, signState, verifyState, type PassRow } from '@/lib/plnolet/model'
import { verifyAssertion, WebAuthnError, type PassAlg } from '@/lib/plnolet/webauthn'
import { getSession, settle, takeAttempt } from '@/lib/plnolet/store'
import { handle, pageError, plnoletOrigin, readJson, rpIdOf, secretOrThrow } from '@/lib/plnolet/http'

const PROBLEM: Record<string, string> = {
  revoked: 'Tento věkový pas byl zrušen. Ověřte se prosím znovu.',
  expired: 'Platnost věkového pasu vypršela. Ověřte se prosím znovu, pas se obnoví.',
  mode: 'Tento pas patří k jinému režimu (testovací / ostrý). Ověřte se jiným způsobem.',
  age: 'Pas potvrzuje nižší věk, než e-shop vyžaduje. Ověřte se prosím jiným způsobem.',
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isSessionId(id)) return pageError(404, 'Odkaz na ověření neexistuje.')
    const body = await readJson(request).catch(() => null)
    if (!body) return pageError(400, 'Neplatný požadavek.')
    const s = await getSession(id)
    if (!s) return pageError(404, 'Odkaz na ověření neexistuje.')
    const secret = secretOrThrow()
    const origin = plnoletOrigin(request)
    const rpId = rpIdOf(origin)

    if (body.step === 'options') {
      if (s.status !== 'pending' || Date.parse(s.expires_at) <= Date.now()) return pageError(409, 'Toto ověření už skončilo.')
      const challenge = randomBytes(32).toString('base64url')
      const token = signState({ sid: id, k: 'get', ch: challenge, exp: Date.now() + 5 * 60_000 }, secret)
      return NextResponse.json({ ok: true, challenge, token, rpId })
    }

    const st = verifyState<{ sid: string; k: string; ch: string; exp: number }>(String(body.token ?? ''), secret, Date.now())
    if (!st || st.sid !== id || st.k !== 'get') return pageError(400, 'Výzva vypršela. Zkuste to prosím znovu.')
    if (!(await takeAttempt(s))) return pageError(409, 'Toto ověření už skončilo.')
    const credentialId = String(body.credentialId ?? '')
    const { data: pass } = await supabaseAdmin
      .from('plnolet_passes').select('id, public_key, alg, sign_count, over18, over21, mode, expires_at, revoked_at')
      .eq('credential_id', credentialId).maybeSingle()
    if (!pass) return pageError(404, 'Tento věkový pas neznáme. Ověřte se prosím jiným způsobem.')
    const problem = passProblem(pass as PassRow, s, Date.now())
    if (problem) return pageError(409, PROBLEM[problem])
    try {
      const r = await verifyAssertion(body, { publicKey: pass.public_key, alg: pass.alg as PassAlg, signCount: Number(pass.sign_count) }, { challenge: st.ch, origin, rpId })
      await supabaseAdmin.from('plnolet_passes').update({ sign_count: r.signCount, last_used_at: new Date().toISOString() }).eq('id', pass.id)
    } catch (e) {
      if (e instanceof WebAuthnError) return pageError(400, 'Věkový pas se nepodařilo ověřit.')
      throw e
    }
    await settle(id, true, 'pass')
    return NextResponse.json({ ok: true, verified: true })
  } catch (e) {
    return handle(e)
  }
}
