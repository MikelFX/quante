// Plnolet API keys for the signed-in merchant. POST { mode, name } → { key } shown once; DELETE ?id=…

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { newKey, type Mode } from '@/lib/plnolet/model'
import { liveAvailable } from '@/lib/plnolet/providers'
import { PlnoletNotSetUpError, merchantForUser } from '@/lib/plnolet/store'
import { readJson } from '@/lib/plnolet/http'

const err = (status: number, error: string) => NextResponse.json({ error }, { status })
const MAX_KEYS = 10

async function merchant() {
  const { userId } = await auth()
  if (!userId) return { res: err(401, 'Přihlaste se.') }
  try {
    const m = await merchantForUser(userId)
    if (!m) return { res: err(404, 'Nejdřív vyplňte údaje e-shopu.') }
    if (m.disabled) return { res: err(403, 'Účet je pozastavený.') }
    return { m }
  } catch (e) {
    return { res: err(e instanceof PlnoletNotSetUpError ? 503 : 500, 'Plnolet ještě není nastavený.') }
  }
}

export async function POST(request: Request) {
  const r = await merchant()
  if (r.res) return r.res
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>)
  const mode: Mode = body.mode === 'live' ? 'live' : 'test'
  if (mode === 'live' && !(r.m.live_enabled && liveAvailable(process.env))) {
    return err(403, 'Ostrý režim zatím není zapnutý. Použijte testovací klíč.')
  }
  const { count } = await supabaseAdmin.from('plnolet_keys').select('id', { count: 'exact', head: true }).eq('merchant_id', r.m.id).is('revoked_at', null)
  if ((count ?? 0) >= MAX_KEYS) return err(400, `Nejvýš ${MAX_KEYS} klíčů. Nějaký nejdřív zrušte.`)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  const k = newKey(mode)
  const { error } = await supabaseAdmin.from('plnolet_keys').insert({ merchant_id: r.m.id, mode, key_hash: k.hash, prefix: k.prefix, name })
  if (error) return err(500, 'Klíč se nepodařilo vytvořit.')
  return NextResponse.json({ key: k.key, mode })
}

export async function DELETE(request: Request) {
  const r = await merchant()
  if (r.res) return r.res
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(id)) return err(400, 'Neplatný klíč.')
  const { error } = await supabaseAdmin.from('plnolet_keys').update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('merchant_id', r.m.id).is('revoked_at', null)
  if (error) return err(500, 'Klíč se nepodařilo zrušit.')
  return NextResponse.json({ ok: true })
}
