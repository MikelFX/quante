// Qads generator credit accounting — reserve up front at submit time, refund
// per failed item. Same manual balance-check + credit_ledger insert pattern
// used by app/api/quante/iterate/route.ts and (previously) the old campaign-
// era version of this file — kept identical shape so a future migration to a
// proper atomic RPC swaps in cleanly at both call sites at once.
//
// This file is *only* about credit bookkeeping; the source-of-truth for how
// many credits a given generation costs lives in lib/qads/pricing.ts, and no
// call site should hardcode numbers.

import { supabaseAdmin } from '@/lib/supabase/admin'

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

export async function reserveGeneratorCredits(params: {
  userId: string
  amount: number
  generationId: string
}): Promise<ReserveResult | ReserveError> {
  const { userId, amount, generationId } = params
  const balance = await getCreditBalance(userId)
  if (balance < amount) {
    return { ok: false, error: 'insufficient_credits', balance, needed: amount }
  }

  const newBalance = balance - amount
  const { error } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    delta: -amount,
    reason: 'qads_generator_reserve',
    ref_id: generationId,
    balance_after: newBalance,
  })
  if (error) return { ok: false, error: 'insufficient_credits', balance, needed: amount }

  return { ok: true, balance: newBalance }
}

// Refund a single failed item's credits (or a batch if a full generation
// fails). Never throws — a refund write failing is worth a log line, not
// blocking the caller (matches the old campaign-era version's posture).
export async function refundGeneratorCredits(params: {
  userId: string
  amount: number
  generationId: string
  reason: string  // e.g. 'qads_item_failed', 'qads_item_nsfw', 'qads_generation_hard_failure'
}): Promise<void> {
  const { userId, amount, generationId, reason } = params
  if (amount <= 0) return
  const balance = await getCreditBalance(userId)
  const newBalance = balance + amount
  const { error } = await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    delta: amount,
    reason,
    ref_id: generationId,
    balance_after: newBalance,
  })
  if (error) {
    console.error(
      `[qads/credits] refund failed for user ${userId}, generation ${generationId}, amount ${amount}:`,
      error.message,
    )
  }
}
