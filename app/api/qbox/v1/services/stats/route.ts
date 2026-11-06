// Public marketplace numbers: { servicesLive, sellers, buyers, paidCalls, volumeUsd, since }.
// Same function as the website's agent counter (lib/qbox/services/stats.ts).

import { NextResponse } from 'next/server'
import { serviceStats } from '@/lib/qbox/services/stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  const s = await serviceStats()
  if (!s) return NextResponse.json({ error: 'Qbox services are not set up yet.' }, { status: 503 })
  return NextResponse.json(s, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } })
}
