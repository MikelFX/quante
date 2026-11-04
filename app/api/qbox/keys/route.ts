// Qbox beta API keys for the signed-in member (/qbox page). Clerk session, not an API key.
//   GET    → { member, limits, usage, keys }   (member: false when not invited)
//   POST   { name } → { key } shown once
//   DELETE ?id=…   → revoke

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { QBOX_BETA, isLive, monthStartUtc, newApiKey, usedMinutes } from '@/lib/qbox/model'
import { QboxNotSetUpError, betaMember, memberSandboxes } from '@/lib/qbox/store'

const err = (status: number, error: string) => NextResponse.json({ error }, { status })

async function member() {
  const { userId } = await auth()
  if (!userId) return { res: err(401, 'Sign in first.') }
  try {
    return { userId, m: await betaMember(userId) }
  } catch (e) {
    if (e instanceof QboxNotSetUpError) return { userId, notSetUp: true as const, m: null }
    return { res: err(500, 'Could not load the beta.') }
  }
}

export async function GET() {
  const r = await member()
  if (r.res) return r.res
  if (r.notSetUp) return NextResponse.json({ setUp: false, member: false })
  if (!r.m) {
    const { data } = await supabaseAdmin.from('qbox_waitlist').select('created_at').eq('user_id', r.userId!).maybeSingle()
    return NextResponse.json({ setUp: true, member: false, waitlisted: !!data })
  }
  const now = Date.now()
  const [keys, rows] = await Promise.all([
    supabaseAdmin.from('qbox_api_keys').select('id, name, prefix, created_at, last_used_at')
      .eq('user_id', r.userId!).is('revoked_at', null).order('created_at', { ascending: false }),
    memberSandboxes(r.userId!, now).catch(() => []),
  ])
  const ms = monthStartUtc(now)
  return NextResponse.json({
    setUp: true,
    member: true,
    limits: { maxConcurrent: r.m.maxConcurrent, monthlyMinutes: r.m.monthlyMinutes, maxTimeoutMinutes: QBOX_BETA.maxTimeoutMs / 60_000 },
    usage: {
      minutes: Math.round(rows.reduce((s, row) => s + usedMinutes(row, now, ms), 0)),
      running: rows.filter((row) => isLive(row, now)).length,
      sandboxes: rows.filter((row) => Date.parse(row.created_at) >= ms).length,
    },
    keys: keys.data ?? [],
  })
}

export async function POST(request: Request) {
  const r = await member()
  if (r.res) return r.res
  if (!r.m) return err(403, r.notSetUp ? 'The beta is not set up yet.' : 'This account is not in the Qbox beta yet.')
  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Default key'
  const { count } = await supabaseAdmin.from('qbox_api_keys').select('id', { count: 'exact', head: true })
    .eq('user_id', r.userId!).is('revoked_at', null)
  if ((count ?? 0) >= QBOX_BETA.maxKeys) return err(400, `At most ${QBOX_BETA.maxKeys} keys. Revoke one first.`)
  const k = newApiKey()
  const { data, error } = await supabaseAdmin.from('qbox_api_keys')
    .insert({ user_id: r.userId!, name, key_hash: k.hash, prefix: k.prefix }).select('id, name, prefix, created_at').single()
  if (error) return err(500, 'Could not create the key.')
  return NextResponse.json({ key: k.key, ...data }, { status: 201 })
}

export async function DELETE(request: Request) {
  const r = await member()
  if (r.res) return r.res
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err(400, 'Missing key id.')
  const { error } = await supabaseAdmin.from('qbox_api_keys').update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', r.userId!).is('revoked_at', null)
  if (error) return err(500, 'Could not revoke the key.')
  return NextResponse.json({ ok: true })
}
