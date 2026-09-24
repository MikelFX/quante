// Qads generator credit accounting — reserve up front, refund per failed item.
//
// Thin wrappers over lib/credits.ts (atomic, advisory-lock-serialised RPCs). The
// old read-balance-then-insert version let parallel requests all pass the balance
// check and write the same balance_after (paid once, rendered N times), and let
// duplicate webhooks / sweeps stack refunds without limit.
//
// Every Qads debit uses reason 'qads_generator_reserve' with ref_id = the
// generation id (a fresh generation reserves once; each regenerate-item adds one
// more debit under the same ref). Every refund goes through refundDebit against
// that ref, so the ledger itself caps refunds at what was actually reserved for
// the generation — even if a caller has a bug. Callers must additionally claim
// the item's terminal transition atomically (see lib/qads/items.ts) so each paid
// attempt is refunded at most once.
//
// The source-of-truth for how many credits a given generation costs lives in
// lib/qads/pricing.ts; no call site should hardcode numbers.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { debitCredits, refundDebit, getBalance } from '@/lib/credits'

export const QADS_RESERVE_REASON = 'qads_generator_reserve'

// Combined per-user cap on paid Qads operations (fresh generations +
// single-item regenerations), counted from the ledger AFTER our own debit so
// parallel requests can't all slip under the limit.
export const QADS_RESERVES_PER_HOUR = 40
// Separate, tighter cap on full generations (each one is a top-tier Claude call).
export const QADS_GENERATIONS_PER_HOUR = 10

export async function getCreditBalance(userId: string): Promise<number> {
  return getBalance(userId)
}

export interface ReserveResult {
  ok: true
  balance: number
}
export interface ReserveError {
  ok: false
  error: 'insufficient_credits' | 'billing_hold' | 'reserve_failed'
  balance: number
  needed: number
}

// Shown to users whose account is flagged after a chargeback (users.billing_hold) —
// same wording as the other credit-debiting routes.
export const QADS_BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

// Atomic debit. The RPC's own balance check is the only one that counts.
// 'billing_hold' is passed through (not folded into 'reserve_failed') so routes can
// answer 402 with code 'billing_hold' instead of a generic retryable 500.
export async function reserveGeneratorCredits(params: {
  userId: string
  amount: number
  generationId: string
}): Promise<ReserveResult | ReserveError> {
  const { userId, amount, generationId } = params
  const res = await debitCredits(userId, amount, QADS_RESERVE_REASON, generationId)
  if (!res.ok) {
    return {
      ok: false,
      error: res.error === 'insufficient_credits' || res.error === 'billing_hold' ? res.error : 'reserve_failed',
      balance: res.balance ?? (await getBalance(userId)),
      needed: amount,
    }
  }
  return { ok: true, balance: res.balance }
}

// Refund part (or, with amount omitted, the remainder) of a generation's
// reservation. Capped by the ledger at what was debited under this generation
// minus what was already refunded under the same reason. Never throws.
export async function refundGeneratorCredits(params: {
  userId: string
  amount?: number
  generationId: string
  reason: string  // e.g. 'qads_item_failed', 'qads_item_nsfw', 'qads_generation_hard_failure'
}): Promise<number> {
  const { userId, amount, generationId, reason } = params
  if (amount !== undefined && (!Number.isInteger(amount) || amount <= 0)) return 0
  const res = await refundDebit(userId, generationId, QADS_RESERVE_REASON, reason, amount)
  if (!res.ok) {
    console.error(
      `[qads/credits] refund failed for user ${userId}, generation ${generationId}, amount ${amount ?? 'remainder'} (${reason})`,
    )
  }
  return res.refunded
}

// Sum of every refund already written against a generation's reservation,
// across all refund reasons. Used by the orphan sweep to refund exactly the
// remainder once, even when earlier partial refunds used other reasons.
export async function sumGenerationRefunds(userId: string, generationId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('credit_ledger')
    .select('delta')
    .eq('user_id', userId)
    .eq('ref_id', generationId)
    .gt('delta', 0)
  return (data ?? []).reduce((acc, r) => acc + ((r.delta as number) ?? 0), 0)
}

// Number of Qads reservations the user made in the last hour, including the
// caller's own (already written) debit.
export async function countRecentReserves(userId: string): Promise<number> {
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await supabaseAdmin
    .from('credit_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('reason', QADS_RESERVE_REASON)
    .lt('delta', 0)
    .gte('created_at', since)
  return count ?? 0
}
