// Store earnings → payout balance. Server-only.
//
// SECURITY (audit 2026-09, #8 / #9 / #28):
//   - Balances are computed PER CURRENCY. Amounts are Stripe minor units of the
//     currency the sale was charged in; summing CZK and EUR (or IDR) rows into one
//     "€" figure let a store inflate its payout balance thousands of times.
//   - Refunds and disputes are negative store_earnings rows (written by the Stripe
//     webhook) and count immediately; positive sales only become payable after a hold
//     period, so a sale that is charged back after purchase can't be cashed out first.
//     Card chargebacks typically arrive 30–90 days after the charge (up to ~120), so the
//     hold defaults to 90 days and can't be configured below 30. While Quante collects
//     store money itself (no Connect destination charges yet), this hold plus the
//     payout-account checks in /api/payout/request are what stand between a stolen-card
//     "store" and a loss for Quante.
//   - Callers must have verified project ownership before calling this.

import { supabaseAdmin } from '@/lib/supabase/admin'

const DEFAULT_HOLD_DAYS = 90
const MIN_HOLD_DAYS = 30
const MAX_HOLD_DAYS = 180

/** Days a positive sale is held before it counts as payable. PAYOUT_HOLD_DAYS env, 30–180. */
export function payoutHoldDays(): number {
  const raw = Number.parseInt(process.env.PAYOUT_HOLD_DAYS ?? '', 10)
  if (!Number.isInteger(raw)) return DEFAULT_HOLD_DAYS
  // Out-of-range values are clamped, never allowed to shorten the hold below the floor.
  return Math.min(MAX_HOLD_DAYS, Math.max(MIN_HOLD_DAYS, raw))
}

const DEFAULT_IBAN_COOLDOWN_DAYS = 7

/** Days after a payout-account (IBAN / holder) change before a payout can be requested. PAYOUT_IBAN_COOLDOWN_DAYS env, 1–60. */
export function payoutIbanCooldownDays(): number {
  const raw = Number.parseInt(process.env.PAYOUT_IBAN_COOLDOWN_DAYS ?? '', 10)
  if (!Number.isInteger(raw)) return DEFAULT_IBAN_COOLDOWN_DAYS
  return Math.min(60, Math.max(1, raw))
}

export interface CurrencyBalance {
  currency: string            // lower-case ISO code
  grossCents: number          // all sales, minus refunds/disputes
  netCents: number            // all net earnings, minus refunds/disputes
  settledNetCents: number     // net earnings past the hold period, minus ALL refunds/disputes
  heldCents: number           // positive net earnings still inside the hold period
  pendingPayoutCents: number  // pending + processing payout requests
  paidOutCents: number
  availableCents: number      // settledNet − pending − paid (may be negative after a late refund)
  saleCount: number
}

const PAGE = 1000

async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

export async function getPayoutBalances(projectId: string): Promise<Map<string, CurrencyBalance>> {
  const holdMs = payoutHoldDays() * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - holdMs

  const [earnings, payouts] = await Promise.all([
    fetchAllRows<{ gross_amount_cents: number; net_amount_cents: number; currency: string | null; created_at: string }>((a, b) =>
      supabaseAdmin
        .from('store_earnings')
        .select('gross_amount_cents, net_amount_cents, currency, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
        .range(a, b),
    ),
    fetchAllRows<{ amount_cents: number; currency: string | null; status: string }>((a, b) =>
      supabaseAdmin
        .from('payout_requests')
        .select('amount_cents, currency, status')
        .eq('project_id', projectId)
        .in('status', ['pending', 'processing', 'paid'])
        .order('created_at', { ascending: true })
        .range(a, b),
    ),
  ])

  const balances = new Map<string, CurrencyBalance>()
  const get = (cur: string | null): CurrencyBalance => {
    const key = (cur ?? 'eur').toLowerCase()
    let b = balances.get(key)
    if (!b) {
      b = { currency: key, grossCents: 0, netCents: 0, settledNetCents: 0, heldCents: 0, pendingPayoutCents: 0, paidOutCents: 0, availableCents: 0, saleCount: 0 }
      balances.set(key, b)
    }
    return b
  }

  for (const e of earnings) {
    const b = get(e.currency)
    const net = Number(e.net_amount_cents) || 0
    b.grossCents += Number(e.gross_amount_cents) || 0
    b.netCents += net
    if (net > 0) b.saleCount += 1
    const createdMs = new Date(e.created_at).getTime()
    // Negative adjustments (refunds / disputes) always count at once; sales only after the hold.
    if (net <= 0 || (Number.isFinite(createdMs) && createdMs <= cutoff)) {
      b.settledNetCents += net
    } else {
      b.heldCents += net
    }
  }

  for (const p of payouts) {
    const b = get(p.currency)
    const amt = Number(p.amount_cents) || 0
    if (p.status === 'paid') b.paidOutCents += amt
    else b.pendingPayoutCents += amt
  }

  for (const b of balances.values()) {
    b.availableCents = b.settledNetCents - b.pendingPayoutCents - b.paidOutCents
  }
  return balances
}
