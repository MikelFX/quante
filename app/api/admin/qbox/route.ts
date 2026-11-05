// Admin → Qbox beta (2026-11-05, owner: see who asked for access without opening Supabase).
//
// GET  /api/admin/qbox → { setUp, requests: [...waitlist, invited flag], members: [...beta rows + keys, sandboxes, minutes this month] }
// POST /api/admin/qbox { userId, action: 'invite' | 'pause' | 'resume' | 'remove', maxConcurrent?, monthlyMinutes? }
//
// Admin only (lib/admin.ts requireAdmin; fails closed). Nothing here touches credits or sandboxes:
// pausing or removing a member only stops new API calls (running sandboxes end at their timeout).

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { QBOX_BETA, QboxInputError, isLive, monthStartUtc, parseAdminAction, usedMinutes, type SandboxRow } from '@/lib/qbox/model'
import { isMissingTable } from '@/lib/qbox/store'

const err = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  const [wait, beta] = await Promise.all([
    supabaseAdmin.from('qbox_waitlist').select('user_id, created_at, email, use_case').order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('qbox_beta').select('user_id, created_at, note, max_concurrent, monthly_minutes, disabled').order('created_at', { ascending: false }).limit(500),
  ])
  if (isMissingTable(wait.error) || isMissingTable(beta.error)) return NextResponse.json({ setUp: false, requests: [], members: [] })
  if (wait.error || beta.error) return err(500, 'Could not load the beta.')

  const now = Date.now()
  const ms = monthStartUtc(now)
  const ids = (beta.data ?? []).map((m) => m.user_id)
  const [keys, boxes] = ids.length
    ? await Promise.all([
        supabaseAdmin.from('qbox_api_keys').select('user_id, last_used_at').in('user_id', ids).is('revoked_at', null),
        supabaseAdmin.from('qbox_sandboxes').select('user_id, status, created_at, expires_at, ended_at')
          .in('user_id', ids).gte('created_at', new Date(ms - QBOX_BETA.maxTimeoutMs).toISOString()).limit(5000),
      ])
    : [{ data: [] }, { data: [] }]

  const emails = new Map((wait.data ?? []).map((w) => [w.user_id, w.email as string | null]))
  const members = (beta.data ?? []).map((m) => {
    const k = (keys.data ?? []).filter((x) => x.user_id === m.user_id)
    const b = ((boxes.data ?? []) as Array<SandboxRow & { user_id: string }>).filter((x) => x.user_id === m.user_id)
    const lastUsed = k.map((x) => x.last_used_at).filter(Boolean).sort().pop() ?? null
    return {
      userId: m.user_id, email: emails.get(m.user_id) ?? null, invitedAt: m.created_at, note: m.note, paused: m.disabled,
      maxConcurrent: m.max_concurrent ?? QBOX_BETA.maxConcurrent, monthlyMinutes: m.monthly_minutes ?? QBOX_BETA.monthlyMinutes,
      keys: k.length, lastUsed,
      sandboxesThisMonth: b.filter((x) => Date.parse(x.created_at) >= ms).length,
      running: b.filter((x) => isLive(x, now)).length,
      minutesThisMonth: Math.round(b.reduce((s, x) => s + usedMinutes(x, now, ms), 0)),
    }
  })
  const invited = new Set(ids)
  const requests = (wait.data ?? []).map((w) => ({ userId: w.user_id, email: w.email, useCase: w.use_case, requestedAt: w.created_at, invited: invited.has(w.user_id) }))
  return NextResponse.json({ setUp: true, requests, members })
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return err(403, 'Admins only.')
  let a
  try {
    a = parseAdminAction(await request.json().catch(() => null))
  } catch (e) {
    return err(400, e instanceof QboxInputError ? e.message : 'Invalid request.')
  }
  const t = supabaseAdmin.from('qbox_beta')
  const { error } =
    a.action === 'invite'
      ? await t.upsert({ user_id: a.userId, disabled: false, max_concurrent: a.maxConcurrent, monthly_minutes: a.monthlyMinutes, note: 'invited in admin' }, { onConflict: 'user_id' })
      : a.action === 'remove'
        ? await t.delete().eq('user_id', a.userId)
        : await t.update({ disabled: a.action === 'pause' }).eq('user_id', a.userId)
  if (error) return err(isMissingTable(error) ? 503 : 500, isMissingTable(error) ? 'Run supabase/migration-qbox-beta.sql first.' : 'Could not save.')
  return NextResponse.json({ ok: true })
}
