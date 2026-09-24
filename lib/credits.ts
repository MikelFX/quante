// Single entry point for every credit_ledger write. Server-only.
//
// All functions call SECURITY DEFINER RPCs from supabase/migration-credits-v2.sql,
// which serialise every ledger write for a user behind one advisory lock and compute
// balance_after inside that lock. NEVER insert into credit_ledger directly and NEVER
// compute balance_after in app code — a read-then-insert races with concurrent
// requests and mints or loses credits.
//
// Pattern for paid work:
//   const ref = randomUUID()
//   const debit = await debitCredits(userId, cost, 'iterate', ref)
//   if (!debit.ok) return 402
//   try { ...do the work... } catch { await refundDebit(userId, ref, 'iterate', 'iterate_failed') }

import { supabaseAdmin } from '@/lib/supabase/admin'

export type DebitResult =
  | { ok: true; balance: number; id: string }
  | { ok: false; error: 'insufficient_credits' | 'invalid_amount' | 'invalid_user' | 'rpc_error' | 'billing_hold'; balance?: number }

export type GrantResult =
  | { ok: true; balance: number; alreadyGranted: boolean }
  | { ok: false; error: string }

export type RefundResult = { ok: boolean; refunded: number; balance?: number }

// Latest row = highest seq (assigned at insert time inside the ledger lock — see
// migration-credits-v2.sql). created_at is transaction-start time and can be out of
// write order, so it is only a fallback for databases where seq doesn't exist yet.
export async function getBalance(userId: string): Promise<number> {
  const bySeq = await supabaseAdmin
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!bySeq.error) return bySeq.data?.balance_after ?? 0
  const { data } = await supabaseAdmin
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.balance_after ?? 0
}

/** Atomically debit `amount` credits. Fails (ok:false) if the balance is too low. */
export async function debitCredits(
  userId: string,
  amount: number,
  reason: string,
  refId: string | null = null,
  opts: { ignoreBillingHold?: boolean } = {},
): Promise<DebitResult> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'invalid_amount' }
  // Accounts flagged after a chargeback / clawback shortfall (users.billing_hold, set by
  // the Stripe webhook) can't spend credits until reviewed. Column missing (migration not
  // run yet) → treated as no hold.
  const { data: hold } = await supabaseAdmin
    .from('users')
    .select('billing_hold')
    .eq('id', userId)
    .maybeSingle()
  if (!opts.ignoreBillingHold && (hold as { billing_hold?: boolean } | null)?.billing_hold === true) {
    return { ok: false, error: 'billing_hold' }
  }
  const { data, error } = await supabaseAdmin.rpc('debit_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId,
  })
  if (error || !data) {
    console.error('[credits] debit_credits rpc failed:', error?.message)
    return { ok: false, error: 'rpc_error' }
  }
  const d = data as { ok: boolean; error?: string; balance?: number; id?: string }
  if (!d.ok) return { ok: false, error: (d.error as 'insufficient_credits') ?? 'rpc_error', balance: d.balance }
  return { ok: true, balance: d.balance ?? 0, id: d.id ?? '' }
}

/** Atomically grant credits. Idempotent per (user, reason, refId) when refId is given. */
export async function grantCredits(
  userId: string,
  amount: number,
  reason: string,
  refId: string | null = null,
): Promise<GrantResult> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'invalid_amount' }
  const { data, error } = await supabaseAdmin.rpc('grant_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_ref_id: refId,
  })
  if (error || !data) {
    console.error('[credits] grant_credits rpc failed:', error?.message)
    return { ok: false, error: 'rpc_error' }
  }
  const d = data as { ok: boolean; error?: string; balance?: number; already_granted?: boolean }
  if (!d.ok) return { ok: false, error: d.error ?? 'rpc_error' }
  return { ok: true, balance: d.balance ?? 0, alreadyGranted: !!d.already_granted }
}

/** One-time welcome grant; no-op if the user already has any ledger row. */
export async function grantWelcomeCredits(userId: string, amount: number, reason = 'welcome_grant'): Promise<GrantResult> {
  const { data, error } = await supabaseAdmin.rpc('grant_welcome_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  })
  if (error || !data) {
    console.error('[credits] grant_welcome_credits rpc failed:', error?.message)
    return { ok: false, error: 'rpc_error' }
  }
  const d = data as { ok: boolean; error?: string; balance?: number; already_granted?: boolean }
  if (!d.ok) return { ok: false, error: d.error ?? 'rpc_error' }
  return { ok: true, balance: d.balance ?? 0, alreadyGranted: !!d.already_granted }
}

/**
 * Refund a previous debit identified by (refId, debitReason). Never refunds more than
 * was debited under that ref minus what was already refunded under refundReason, so it
 * is safe to call repeatedly / concurrently. `amount` omitted = refund the remainder.
 * Never throws.
 */
export async function refundDebit(
  userId: string,
  refId: string,
  debitReason: string,
  refundReason: string,
  amount?: number,
): Promise<RefundResult> {
  const { data, error } = await supabaseAdmin.rpc('refund_debit', {
    p_user_id: userId,
    p_ref_id: refId,
    p_debit_reason: debitReason,
    p_refund_reason: refundReason,
    p_amount: amount ?? null,
  })
  if (error || !data) {
    console.error('[credits] refund_debit rpc failed:', error?.message)
    return { ok: false, refunded: 0 }
  }
  const d = data as { ok: boolean; refunded?: number; balance?: number }
  return { ok: d.ok, refunded: d.refunded ?? 0, balance: d.balance }
}
