import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const MIN_PAYOUT_CENTS = 500 // €5 minimum

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Get IBAN
  const { data: payoutAccount } = await supabaseAdmin
    .from('store_payout_accounts')
    .select('iban, account_holder_name, bank_name')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!payoutAccount?.iban) {
    return NextResponse.json({ error: 'No payout account set. Add your IBAN first.' }, { status: 400 })
  }

  // Calculate available balance
  const { data: earnings } = await supabaseAdmin
    .from('store_earnings')
    .select('net_amount_cents, currency')
    .eq('project_id', projectId)

  const netTotal = (earnings ?? []).reduce((s, e) => s + e.net_amount_cents, 0)
  const currency = earnings?.[0]?.currency ?? 'eur'

  const { data: payoutRows } = await supabaseAdmin
    .from('payout_requests')
    .select('amount_cents, status')
    .eq('project_id', projectId)
    .in('status', ['pending', 'processing', 'paid'])

  const alreadyClaimed = (payoutRows ?? []).reduce((s, p) => s + p.amount_cents, 0)
  const availableCents = netTotal - alreadyClaimed

  if (availableCents < MIN_PAYOUT_CENTS) {
    return NextResponse.json(
      { error: `Minimum payout is €${MIN_PAYOUT_CENTS / 100}. Available: €${(availableCents / 100).toFixed(2)}` },
      { status: 400 },
    )
  }

  const { data: payout, error } = await supabaseAdmin
    .from('payout_requests')
    .insert({
      project_id: projectId,
      user_id: userId,
      amount_cents: availableCents,
      currency,
      status: 'pending',
      iban: payoutAccount.iban,
      account_holder_name: payoutAccount.account_holder_name,
    })
    .select('id')
    .single()

  if (error || !payout) {
    return NextResponse.json({ error: 'Failed to create payout request.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, payoutId: payout.id, amountCents: availableCents })
}
