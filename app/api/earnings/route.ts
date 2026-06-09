import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: earnings } = await supabaseAdmin
    .from('store_earnings')
    .select('gross_amount_cents, net_amount_cents, platform_fee_cents, currency, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  const rows = earnings ?? []
  const grossTotal = rows.reduce((s, r) => s + r.gross_amount_cents, 0)
  const netTotal = rows.reduce((s, r) => s + r.net_amount_cents, 0)

  // Subtract already-requested payouts
  const { data: payoutRows } = await supabaseAdmin
    .from('payout_requests')
    .select('amount_cents, status')
    .eq('project_id', projectId)
    .in('status', ['pending', 'processing', 'paid'])

  const pendingPayouts = (payoutRows ?? [])
    .filter((p) => p.status === 'pending' || p.status === 'processing')
    .reduce((s, p) => s + p.amount_cents, 0)
  const paidOut = (payoutRows ?? [])
    .filter((p) => p.status === 'paid')
    .reduce((s, p) => s + p.amount_cents, 0)

  const availableCents = netTotal - pendingPayouts - paidOut
  const currency = rows[0]?.currency ?? 'eur'

  return NextResponse.json({
    grossTotal: grossTotal / 100,
    netTotal: netTotal / 100,
    availableCents,
    available: availableCents / 100,
    paidOut: paidOut / 100,
    pendingPayoutCents: pendingPayouts,
    currency: currency.toUpperCase(),
    saleCount: rows.length,
  })
}
