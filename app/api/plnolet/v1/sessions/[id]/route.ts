// Plnolet merchant API: GET /api/plnolet/v1/sessions/{id} — the result of one verification.
// Only the merchant that opened it can read it. `verified: true` is the only answer to act on.

import { NextResponse } from 'next/server'
import { isSessionId } from '@/lib/plnolet/model'
import { apiError, authenticate, getSession, sessionJson } from '@/lib/plnolet/store'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { id } = await params
  if (!isSessionId(id)) return apiError(404, 'No such session.', 'not_found')
  const s = await getSession(id).catch(() => null)
  if (!s || s.merchant_id !== a.merchant.id || s.mode !== a.mode) return apiError(404, 'No such session.', 'not_found')
  return NextResponse.json(sessionJson(s, Date.now()), { headers: { 'cache-control': 'no-store' } })
}
