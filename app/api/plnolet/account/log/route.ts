// Plnolet verification log as CSV (for an inspection by ČOI / the regional hygiene office).
// GET ?days=90 — the signed-in merchant's sessions, newest first. No shopper data exists to export.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logCsv, type LogRow } from '@/lib/plnolet/model'
import { merchantForUser } from '@/lib/plnolet/store'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Přihlaste se.' }, { status: 401 })
  const m = await merchantForUser(userId).catch(() => null)
  if (!m) return NextResponse.json({ error: 'Účet neexistuje.' }, { status: 404 })
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 90, 1), 730)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('plnolet_sessions').select('id, created_at, expires_at, verified_at, status, threshold, method, reference, mode')
    .eq('merchant_id', m.id).gte('created_at', since).order('created_at', { ascending: false }).limit(50000)
  if (error) return NextResponse.json({ error: 'Záznamy se nepodařilo načíst.' }, { status: 500 })
  const day = new Date().toISOString().slice(0, 10)
  return new NextResponse('﻿' + logCsv((data ?? []) as LogRow[], Date.now()), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="plnolet-overeni-${day}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
