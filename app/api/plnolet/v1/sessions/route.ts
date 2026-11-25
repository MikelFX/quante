// Plnolet merchant API: POST /api/plnolet/v1/sessions — open an age verification for one order.
//   Authorization: Bearer plt_test_… | plt_live_…
//   { "min_age": 18 | 21, "return_url": "https://your-shop.cz/checkout", "reference": "order-123" }
//   → 201 { id, url, status: "pending", expires_at, … }   Send the shopper to `url` (or open it with
//   the widget); afterwards ask GET /api/plnolet/v1/sessions/{id} for the result — never trust the
//   browser's return alone.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { PLNOLET, PlnoletInputError, newSessionId, parseSession } from '@/lib/plnolet/model'
import { apiError, authenticate, sessionJson, sessionsLastHour, type Session } from '@/lib/plnolet/store'
import { plnoletOrigin } from '@/lib/plnolet/http'

export async function POST(request: Request) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'Send a JSON body.', 'invalid_json')
  }
  let input
  try {
    input = parseSession(body, a.mode, a.merchant.domains)
  } catch (e) {
    if (e instanceof PlnoletInputError) return apiError(400, e.message, 'invalid_request')
    throw e
  }
  try {
    if ((await sessionsLastHour(a.keyId)) >= PLNOLET.sessionsPerKeyHour) {
      return apiError(429, `At most ${PLNOLET.sessionsPerKeyHour} sessions an hour per key.`, 'rate_limited')
    }
  } catch {
    return apiError(503, 'Plnolet is not set up yet.', 'not_set_up')
  }
  const now = Date.now()
  const row = {
    id: newSessionId(),
    merchant_id: a.merchant.id,
    key_id: a.keyId,
    mode: a.mode,
    threshold: input.threshold,
    return_url: input.returnUrl,
    reference: input.reference,
    expires_at: new Date(now + PLNOLET.sessionTtlMs).toISOString(),
  }
  const { data, error } = await supabaseAdmin.from('plnolet_sessions').insert(row).select('*').single()
  if (error || !data) return apiError(500, 'Could not open the session.')
  const url = `${plnoletOrigin(request)}/plnolet/v/${row.id}`
  return NextResponse.json({ ...sessionJson(data as Session, now), url }, { status: 201 })
}
