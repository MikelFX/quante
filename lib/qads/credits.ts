// Qads credit accounting — estimate/reserve/settle/refund. Deliberately mirrors the
// manual balance-check + credit_ledger insert pattern already used by
// app/api/quante/iterate/route.ts (read latest balance_after, compare, insert one row)
// rather than the unused supabase/migration-atomic-credits.sql `debit_credits` RPC, whose
// `p_user_id uuid` signature doesn't match this app's actual user id type (Clerk's
// string sub, stored as `text` everywhere else in this schema) — that RPC appears to
// predate the Clerk migration and nothing else in the repo calls it.
//
// QADS_CREDIT_COSTS is new but follows CREDIT_COSTS/lib/config.ts exactly (never inline
// these numbers at a call site).

import { supabaseAdmin } from '@/lib/supabase/admin'

export const QADS_CREDIT_COSTS = {
  strategy_generation: 3,   // one strategy+angles+ad-sets+copy call (lib/qads/pipeline/nodes/strategy.ts)
  static_creative: 1,        // per generated image
  video_creative: 5,         // per generated video (Higgsfield video is the expensive op)
  experiment_setup: 1,
} as const

export type QadsCreditReason = keyof typeof QADS_CREDIT_COSTS

export interface CreditCheckResult {
  ok: boolean
  balance: number
}

// Read-only balance check — same query shape as iterate/route.ts.
export async function getCreditBalance(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.balance_after ?? 0
}

// Estimate the total cost of a campaign generation request before spending anything —
// POST /api/qads/campaigns shows this to the merchant for approval BEFORE reserving.
// Matches "Estimate → reserve → settle/refund" from docs/qads-proposal.md §6.
export function estimateCampaignCost(params: {
  angleCount: number
  adSetsPerAngle: number
  staticCreativesPerAdSet: number
  videoCreativesPerAdSet: number
}): number {
  const { angleCount, adSetsPerAngle, staticCreativesPerAdSet, videoCreativesPerAdSet } = params
  const adSetCount = angleCount * adSetsPerAngle
  return (
    QADS_CREDIT_COSTS.strategy_generation +
    adSetCount * staticCreativesPerAdSet * QADS_CREDIT_COSTS.static_creative +
    adSetCount * videoCreativesPerAdSet * QADS_CREDIT_COSTS.video_creative
  )
}

export interface ReserveResult {
  ok: true
  balance: number
}
export interface ReserveError {
  ok: false
  error: 'insufficient_credits'
  balance: number
  needed: number
}

// Reserves (debits) `amount` credits up front for a campaign, before the pipeline starts.
// Per-asset generation failures are refunded individually as they're known (see
// refundCredits below) rather than waiting for the whole campaign to finish — "vrácení za
// neúspěšné assety", not a blanket all-or-nothing refund.
export async function reserveCredits(params: {
  userId: string
  amount: number
  campaignId: string
}): Promise<ReserveResult | ReserveError> {
  const { userId, amount, campaignId } = params
  const balance = await getCreditBalance(userId)
  if (balance < amount) {
    return { ok: false, error: 'insufficient_credits', balance, needed: amount }
  }

  const newBalance = balance - amount
  const { error } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    delta: -amount,
    reason: 'qads_campaign_reserve',
    ref_id: campaignId,
    balance_after: newBalance,
  })
  if (error) return { ok: false, error: 'insufficient_credits', balance, needed: amount }

  return { ok: true, balance: newBalance }
}

// Refunds `amount` credits — used both for a hard pipeline failure (refund everything
// reserved) and for a single failed creative generation (refund just that asset's cost).
// Never throws: a refund failure is logged, not surfaced as a user-facing error, since the
// alternative (blocking on it) would leave the merchant stuck mid-campaign over a
// bookkeeping write — matches this repo's "never debit before success, but don't let a
// refund write become a new outage" posture from CLAUDE.md §5.
export async function refundCredits(params: {
  userId: string
  amount: number
  campaignId: string
  reason: string
}): Promise<void> {
  const { userId, amount, campaignId, reason } = params
  if (amount <= 0) return
  const balance = await getCreditBalance(userId)
  const newBalance = balance + amount
  const { error } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    delta: amount,
    reason,
    ref_id: campaignId,
    balance_after: newBalance,
  })
  if (error) {
    console.error(`[qads/credits] refund failed for user ${userId}, campaign ${campaignId}, amount ${amount}:`, error.message)
  }
}
