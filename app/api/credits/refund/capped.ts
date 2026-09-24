// Daily-capped refunds. Server-only. Shared by /api/credits/refund and the capped refunds
// in /api/quante/generate.
//
// SECURITY: refunds for failures a user can provoke on purpose (unusable model output,
// a build that never passes auto-fix) would otherwise make the model free to use, so
// they are capped per user per day. The cap is counted from credit_refund_claims
// (supabase/migration-security-generate.sql), NOT from credit_ledger rows with reason
// 'generation_failed' — uncapped infra refunds and iterate's failure refunds write that
// reason too, and counting them used up legitimate users' caps. The refund itself keeps
// reason 'generation_failed' (refund_debit is idempotent per refund reason — a second
// reason on the same debit could refund it twice).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { refundDebit } from '@/lib/credits'

export const DAILY_CAPPED_REFUND_LIMIT = 5
const DAY_MS = 86_400_000

export type CappedRefundResult =
  | { ok: true; refunded: number; balance?: number }
  | { ok: false; reason: 'limit' | 'error' }

async function releaseClaim(claimId: string) {
  const { error } = await supabaseAdmin.from('credit_refund_claims').delete().eq('id', claimId)
  if (error) console.error('[refund:capped] claim release failed:', error.message)
}

/** Old, stricter cap (counts every 'generation_failed' ledger row) — only used until the claims table exists. */
async function legacyCapReached(userId: string, refundReason: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('credit_ledger').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('reason', refundReason)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
  return !!error || (count ?? 0) >= DAILY_CAPPED_REFUND_LIMIT
}

/**
 * Refunds the debit (debitRef, debitReason) if the user is under the daily capped-refund
 * limit. Reserve-then-count: the claim row is inserted first and counted together with
 * the user's other claims, so concurrent calls can't all pass. Idempotent per debitRef.
 */
export async function refundCapped(
  userId: string,
  debitRef: string,
  debitReason: string,
  refundReason: string,
): Promise<CappedRefundResult> {
  const { data: claim, error: claimError } = await supabaseAdmin
    .from('credit_refund_claims')
    .insert({ user_id: userId, debit_ref: debitRef })
    .select('id')
    .single()

  if (claimError || !claim) {
    if (claimError?.code === '23505') {
      // Already claimed for this debit — refund_debit is idempotent, so this only
      // completes a refund that didn't finish and can never pay out twice.
      const res = await refundDebit(userId, debitRef, debitReason, refundReason)
      return res.ok ? { ok: true, refunded: res.refunded, balance: res.balance } : { ok: false, reason: 'error' }
    }
    // Table missing (migration not run) or DB error — fall back to the stricter legacy cap.
    console.error('[refund:capped] claim insert failed (run migration-security-generate.sql?):', claimError?.message)
    if (await legacyCapReached(userId, refundReason)) return { ok: false, reason: 'limit' }
    const res = await refundDebit(userId, debitRef, debitReason, refundReason)
    return res.ok ? { ok: true, refunded: res.refunded, balance: res.balance } : { ok: false, reason: 'error' }
  }

  const claimId = (claim as { id: string }).id
  const { count, error: countError } = await supabaseAdmin
    .from('credit_refund_claims').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
  if (countError) {
    console.error('[refund:capped] claim count failed:', countError.message)
    await releaseClaim(claimId)
    return { ok: false, reason: 'error' }
  }
  if ((count ?? 0) > DAILY_CAPPED_REFUND_LIMIT) {
    await releaseClaim(claimId)
    return { ok: false, reason: 'limit' }
  }

  const res = await refundDebit(userId, debitRef, debitReason, refundReason)
  // Nothing refunded (already refunded elsewhere, or the RPC failed) — don't burn the cap.
  if (!res.ok || res.refunded <= 0) await releaseClaim(claimId)
  return res.ok ? { ok: true, refunded: res.refunded, balance: res.balance } : { ok: false, reason: 'error' }
}
