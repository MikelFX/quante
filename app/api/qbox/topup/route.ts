// /qbox page: Quante credits → Qbox balance for the signed-in account (Clerk session; the same
// rule as POST /api/qbox/v1/billing {credits}: only after a real credit purchase).
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { betaMember } from '@/lib/qbox/store'
import { topUpWithCredits } from '@/lib/qbox/billing'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  const m = await betaMember(userId).catch(() => null)
  if (!m || m.tier !== 'paid') return NextResponse.json({ error: 'Top-ups are for the paid plan.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const r = await topUpWithCredits(userId, Number(body?.credits))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
