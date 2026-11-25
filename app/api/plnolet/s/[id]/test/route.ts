// Plnolet shopper page, test sessions only: POST { adult: true | false } settles the session the
// way a real check would, so a merchant can build their integration without a real identity.

import { NextResponse } from 'next/server'
import { isSessionId, signState } from '@/lib/plnolet/model'
import { getSession, settle, takeAttempt } from '@/lib/plnolet/store'
import { handle, issueCookie, pageError, readJson, secretOrThrow } from '@/lib/plnolet/http'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isSessionId(id)) return pageError(404, 'Odkaz na ověření neexistuje.')
    const s = await getSession(id)
    if (!s) return pageError(404, 'Odkaz na ověření neexistuje.')
    if (s.mode !== 'test') return pageError(403, 'Testovací ověření funguje jen v testovacím režimu.')
    if (!(await takeAttempt(s))) return pageError(409, 'Toto ověření už skončilo.')
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>)
    const adult = body.adult === true
    await settle(id, adult, 'test')
    const res = NextResponse.json({ ok: true, verified: adult })
    if (adult) res.cookies.set(issueCookie(id, { m: 'test', a18: true, a21: true }, secretOrThrow(), signState))
    return res
  } catch (e) {
    return handle(e)
  }
}
