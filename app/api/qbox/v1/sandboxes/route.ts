// Qbox API (closed beta): POST /api/qbox/v1/sandboxes — start a sandbox; GET — list this month's.
// Auth: `Authorization: Bearer qbx_…` (keys from /qbox). Limits: lib/qbox/model.ts QBOX_BETA.

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { QBOX_BETA, QboxInputError, admitCreate, parseCreate, publicSandbox } from '@/lib/qbox/model'
import { apiError, authenticate, globalLiveCount, markEnded, memberSandboxes } from '@/lib/qbox/store'
import { engine } from '@/lib/qbox/vercel'
import { EngineUnavailableError } from '@/lib/qbox/provider'

export const maxDuration = 60

export async function POST(request: Request) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { member, keyId } = a

  if (!rateLimit(`qbox:create:${member.userId}`, 5, 60_000).allowed) return apiError(429, 'At most 5 new sandboxes a minute.')

  let input
  try {
    input = parseCreate(await request.json().catch(() => ({})))
  } catch (e) {
    return apiError(400, e instanceof QboxInputError ? e.message : 'Invalid request body.')
  }

  const now = Date.now()
  let rows, globalLive
  try {
    ;[rows, globalLive] = await Promise.all([memberSandboxes(member.userId, now), globalLiveCount(now)])
  } catch {
    return apiError(503, 'Qbox beta is not set up yet.')
  }
  const admit = admitCreate(rows, member, input.timeoutMs, now, globalLive)
  if (!admit.ok) return apiError(admit.status, admit.error)

  const id = randomUUID()
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + input.timeoutMs).toISOString()
  // The row comes first: it reserves the slot and the minutes before the engine spends anything.
  const { error: insErr } = await supabaseAdmin.from('qbox_sandboxes').insert({
    id, user_id: member.userId, key_id: keyId, created_at: createdAt, expires_at: expiresAt,
    status: 'running', engine: engine().name, template: input.template, ports: input.ports, metadata: input.metadata,
  })
  if (insErr) return apiError(503, 'Qbox beta is not set up yet.')

  try {
    await engine().create({
      id, template: input.template, timeoutMs: input.timeoutMs, ports: input.ports,
      internet: input.internet, env: input.env, vcpus: QBOX_BETA.vcpus, tags: { sandbox: id },
    })
  } catch (e) {
    console.error('[qbox] create failed', e)
    await markEnded(id, 'failed', String((e as Error)?.message ?? e))
    if (e instanceof EngineUnavailableError) return apiError(503, 'Sandboxes are not available right now.')
    return apiError(502, 'The sandbox could not be started. Nothing was counted; try again.')
  }

  const previews: Record<string, string> = {}
  for (const p of input.ports) {
    const url = await engine().previewUrl(id, p).catch(() => null)
    if (url) previews[String(p)] = url
  }
  const row = { id, status: 'running' as const, created_at: createdAt, expires_at: expiresAt, ended_at: null, template: input.template, ports: input.ports }
  return NextResponse.json(publicSandbox(row, Date.now(), previews), { status: 201 })
}

export async function GET(request: Request) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const now = Date.now()
  try {
    const rows = await memberSandboxes(a.member.userId, now)
    return NextResponse.json({ sandboxes: rows.slice(0, 100).map((r) => publicSandbox(r, now)) })
  } catch {
    return apiError(503, 'Qbox beta is not set up yet.')
  }
}
