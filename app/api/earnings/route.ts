import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { getPayoutBalances, payoutHoldDays } from '@/lib/payments/earnings'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  if (!projectId) return NextResponse.json({ error: 'project_id required' }, { status: 400 })

  // Ownership check
  const project = await getOwnedProject(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const [balances, { data: codeVersion }] = await Promise.all([
    getPayoutBalances(projectId).catch((err) => {
      console.error('[earnings] balance lookup failed:', err)
      return null
    }),
    supabaseAdmin
      .from('code_versions')
      .select('files')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!balances) return NextResponse.json({ error: 'Could not load earnings.' }, { status: 500 })

  // Display currency: the store's configured currency (same fallback as
  // revenue/route.ts), else the currency with the most sales. Totals are NEVER summed
  // across currencies — every other currency is reported separately in `byCurrency`.
  const files = (codeVersion?.files ?? {}) as Record<string, string>
  const configured = (files['data/config.ts'] ?? '').match(/currency:\s*['"]([A-Za-z]{3})['"]/)?.[1]?.toLowerCase()
  const list = [...balances.values()]
  const currency =
    (configured && balances.has(configured) ? configured : undefined)
    ?? list.sort((a, b) => b.saleCount - a.saleCount)[0]?.currency
    ?? configured
    ?? 'eur'
  const b = balances.get(currency)

  const availableCents = b?.availableCents ?? 0

  return NextResponse.json({
    grossTotal: (b?.grossCents ?? 0) / 100,
    netTotal: (b?.netCents ?? 0) / 100,
    availableCents,
    available: availableCents / 100,
    paidOut: (b?.paidOutCents ?? 0) / 100,
    pendingPayoutCents: b?.pendingPayoutCents ?? 0,
    currency: currency.toUpperCase(),
    saleCount: b?.saleCount ?? 0,
    // Additive fields (audit #8/#9): funds still in the hold period, and per-currency balances.
    heldCents: b?.heldCents ?? 0,
    holdDays: payoutHoldDays(),
    byCurrency: list.map((x) => ({
      currency: x.currency.toUpperCase(),
      grossCents: x.grossCents,
      netCents: x.netCents,
      availableCents: x.availableCents,
      heldCents: x.heldCents,
      pendingPayoutCents: x.pendingPayoutCents,
      paidOutCents: x.paidOutCents,
      saleCount: x.saleCount,
    })),
  })
}
