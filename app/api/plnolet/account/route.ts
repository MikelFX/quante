// Plnolet merchant account for the signed-in user (/plnolet/ucet). Clerk session, not an API key.
//   GET → { setUp, merchant, keys, live, recent, month }
//   PUT { name, domains } → creates or updates the merchant profile

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { PlnoletInputError, effectiveStatus, parseMerchant } from '@/lib/plnolet/model'
import { liveAvailable, providers } from '@/lib/plnolet/providers'
import { PlnoletNotSetUpError, merchantForUser } from '@/lib/plnolet/store'
import { readJson } from '@/lib/plnolet/http'

const err = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function GET() {
  const { userId } = await auth()
  if (!userId) return err(401, 'Přihlaste se.')
  let merchant
  try {
    merchant = await merchantForUser(userId)
  } catch (e) {
    if (e instanceof PlnoletNotSetUpError) return NextResponse.json({ setUp: false })
    return err(500, 'Účet se nepodařilo načíst.')
  }
  const methods = providers(process.env).map((p) => p.id)
  if (!merchant) return NextResponse.json({ setUp: true, merchant: null, methods })
  const now = Date.now()
  const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString()
  const [keys, recent, month] = await Promise.all([
    supabaseAdmin.from('plnolet_keys').select('id, mode, name, prefix, created_at, last_used_at')
      .eq('merchant_id', merchant.id).is('revoked_at', null).order('created_at', { ascending: false }),
    supabaseAdmin.from('plnolet_sessions').select('id, mode, threshold, status, method, reference, created_at, expires_at, verified_at')
      .eq('merchant_id', merchant.id).order('created_at', { ascending: false }).limit(50),
    supabaseAdmin.from('plnolet_sessions').select('status, method, mode, expires_at')
      .eq('merchant_id', merchant.id).gte('created_at', monthStart).limit(20000),
  ])
  const m = (month.data ?? []).map((r) => ({ ...r, status: effectiveStatus(r, now) }))
  const live = m.filter((r) => r.mode === 'live')
  return NextResponse.json({
    setUp: true,
    merchant: { name: merchant.name, domains: merchant.domains, liveEnabled: merchant.live_enabled, disabled: merchant.disabled },
    live: merchant.live_enabled && liveAvailable(process.env),
    methods,
    keys: keys.data ?? [],
    recent: (recent.data ?? []).map((r) => ({ ...r, status: effectiveStatus(r, now) })),
    month: {
      sessions: live.length,
      verified: live.filter((r) => r.status === 'verified').length,
      // What a plan counts: new identity checks; returning shoppers with an age pass are free.
      newChecks: live.filter((r) => r.status === 'verified' && r.method !== 'pass').length,
      byPass: live.filter((r) => r.method === 'pass').length,
      test: m.length - live.length,
    },
  })
}

export async function PUT(request: Request) {
  const { userId } = await auth()
  if (!userId) return err(401, 'Přihlaste se.')
  let input
  try {
    input = parseMerchant(await readJson(request))
  } catch (e) {
    if (e instanceof PlnoletInputError) return err(400, e.message)
    return err(400, 'Neplatný požadavek.')
  }
  try {
    const existing = await merchantForUser(userId)
    const q = existing
      ? supabaseAdmin.from('plnolet_merchants').update(input).eq('id', existing.id)
      : supabaseAdmin.from('plnolet_merchants').insert({ user_id: userId, ...input })
    const { error } = await q
    if (error) return err(500, 'Uložení se nepovedlo.')
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof PlnoletNotSetUpError) return err(503, 'Plnolet ještě není nastavený.')
    return err(500, 'Uložení se nepovedlo.')
  }
}
