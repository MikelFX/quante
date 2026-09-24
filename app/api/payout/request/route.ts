import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { getPayoutBalances, payoutHoldDays, payoutIbanCooldownDays } from '@/lib/payments/earnings'

const MIN_PAYOUT_CENTS = 500 // 5.00 in the payout currency

function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '42703' || err.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column/i.test(err.message ?? '')
}

function fmt(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

// SECURITY (audit #8 / #9 / #28):
//   - The balance is per currency and only counts settled earnings (past the hold
//     period) minus every refund/dispute — see lib/payments/earnings.ts.
//   - The payout account must be identity-verified by an operator, and payouts pause
//     for PAYOUT_IBAN_COOLDOWN_DAYS after any IBAN / holder change.
//   - At most ONE open (pending/processing) request per project + currency, enforced by
//     the partial unique index in supabase/migration-security-stripe-payments.sql, plus
//     a re-check after the insert: if the balance went negative (a concurrent request
//     or a refund landed in between), our row is withdrawn again.
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; currency?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { projectId } = body
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const project = await getOwnedProject(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const pid = projectId as string

  let requestedCurrency: string | null = null
  if (body.currency !== undefined && body.currency !== null) {
    if (typeof body.currency !== 'string' || !/^[a-zA-Z]{3}$/.test(body.currency)) {
      return NextResponse.json({ error: 'Invalid currency' }, { status: 400 })
    }
    requestedCurrency = body.currency.toLowerCase()
  }

  // Get IBAN (+ change / verification stamps; see /api/payout/account).
  let { data: accountRow, error: accountErr } = await supabaseAdmin
    .from('store_payout_accounts')
    .select('iban, account_holder_name, bank_name, updated_at, iban_changed_at, identity_verified_at')
    .eq('project_id', pid)
    .maybeSingle()
  if (accountErr && isMissingColumn(accountErr)) {
    ;({ data: accountRow, error: accountErr } = await supabaseAdmin
      .from('store_payout_accounts')
      .select('iban, account_holder_name, bank_name, updated_at')
      .eq('project_id', pid)
      .maybeSingle())
  }
  if (accountErr) {
    console.error('[payout/request] payout account lookup failed:', accountErr.message)
    return NextResponse.json({ error: 'Could not load payout account. Try again.' }, { status: 500 })
  }
  const payoutAccount = accountRow as {
    iban: string; account_holder_name: string; bank_name: string | null; updated_at: string | null
    iban_changed_at?: string | null; identity_verified_at?: string | null
  } | null

  if (!payoutAccount?.iban) {
    return NextResponse.json({ error: 'No payout account set. Add your IBAN first.' }, { status: 400 })
  }

  // Identity verification (#9): money only goes to an account an operator has matched
  // to the verified store owner. Fails closed (also before the migration is applied).
  if (!payoutAccount.identity_verified_at) {
    return NextResponse.json(
      { error: 'Your payout account is awaiting identity verification. We will contact you before the first payout.' },
      { status: 403 },
    )
  }

  // Cool-down after an IBAN / holder change (#9). Without iban_changed_at (pre-migration)
  // the last save time is used, which is at least as strict.
  const changedAt = payoutAccount.iban_changed_at ?? payoutAccount.updated_at
  const changedMs = changedAt ? Date.parse(changedAt) : NaN
  const cooldownMs = payoutIbanCooldownDays() * 24 * 60 * 60 * 1000
  if (!Number.isFinite(changedMs) || Date.now() - changedMs < cooldownMs) {
    const from = Number.isFinite(changedMs) ? new Date(changedMs + cooldownMs).toISOString().slice(0, 10) : null
    return NextResponse.json(
      {
        error: `Payouts are paused for ${payoutIbanCooldownDays()} days after the payout account changes`
          + (from ? ` (available from ${from}).` : '.'),
      },
      { status: 409 },
    )
  }

  let balances
  try {
    balances = await getPayoutBalances(pid)
  } catch (err) {
    console.error('[payout/request] balance lookup failed:', err)
    return NextResponse.json({ error: 'Could not compute balance. Try again.' }, { status: 500 })
  }

  let currency: string
  if (requestedCurrency) {
    currency = requestedCurrency
  } else {
    const eligible = [...balances.values()].filter((b) => b.availableCents >= MIN_PAYOUT_CENTS)
    if (eligible.length > 1) {
      return NextResponse.json(
        { error: `Balances exist in several currencies (${eligible.map((b) => b.currency.toUpperCase()).join(', ')}). Specify which one to pay out.` },
        { status: 400 },
      )
    }
    const best = eligible[0] ?? [...balances.values()].sort((a, b) => b.availableCents - a.availableCents)[0]
    currency = best?.currency ?? 'eur'
  }

  const balance = balances.get(currency)
  const availableCents = balance?.availableCents ?? 0

  if (availableCents < MIN_PAYOUT_CENTS) {
    const held = balance?.heldCents ?? 0
    return NextResponse.json(
      {
        error: `Minimum payout is ${fmt(MIN_PAYOUT_CENTS, currency)}. Available: ${fmt(Math.max(0, availableCents), currency)}`
          + (held > 0 ? ` (${fmt(held, currency)} still in the ${payoutHoldDays()}-day hold period)` : ''),
      },
      { status: 400 },
    )
  }

  const { data: payout, error } = await supabaseAdmin
    .from('payout_requests')
    .insert({
      project_id: pid,
      user_id: userId,
      amount_cents: availableCents,
      currency,
      status: 'pending',
      iban: payoutAccount.iban,
      account_holder_name: payoutAccount.account_holder_name,
    })
    .select('id')
    .single()

  if (error?.code === '23505') {
    return NextResponse.json({ error: 'A payout request for this currency is already in progress.' }, { status: 409 })
  }
  if (error || !payout) {
    return NextResponse.json({ error: 'Failed to create payout request.' }, { status: 500 })
  }

  // Re-check with our row included: two concurrent requests (e.g. before the unique
  // index is deployed) or a refund that landed meanwhile would make this negative.
  try {
    const after = (await getPayoutBalances(pid)).get(currency)
    if (!after || after.availableCents < 0) {
      await supabaseAdmin.from('payout_requests').delete().eq('id', payout.id).eq('status', 'pending')
      return NextResponse.json({ error: 'Balance changed while requesting the payout. Please try again.' }, { status: 409 })
    }
  } catch (err) {
    console.error('[payout/request] post-insert re-check failed:', err)
    await supabaseAdmin.from('payout_requests').delete().eq('id', payout.id).eq('status', 'pending')
    return NextResponse.json({ error: 'Could not verify balance. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, payoutId: payout.id, amountCents: availableCents, currency: currency.toUpperCase() })
}
