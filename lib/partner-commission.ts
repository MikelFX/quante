// Partner commission — calculation + the idempotent ledger-insert helper.
//
// SAFETY: this module only ever COMPUTES and RECORDS what a partner has earned, as an
// append-only bookkeeping row in partner_commission_ledger. There is no payout/transfer
// code here or anywhere else in the partner program — moving real money (e.g. a Stripe
// Connect transfer) is a deliberate, separate feature left for the user to build and
// activate later. See supabase/migration-partners.sql's header comment.
//
// SECURITY — before wiring ANY payout, transfer, discount or credit grant off
// partner_commission_ledger: commission on a project the partner owns or pays for must
// NEVER be paid out (getActivePartnerForProject() refuses it; rows recorded before that
// guard existed may still be self-commission and must be excluded/cleaned up). Also move
// the balance_after_cents computation into a locked SQL function first — the
// read-then-insert below races under concurrent webhook deliveries.
//
// Kept dependency-light (only supabaseAdmin) so calculateCommissionCents() itself is
// trivially unit-testable — see __tests__/partner-commission.test.mjs.

import { supabaseAdmin } from './supabase/admin'

export function calculateCommissionCents(amountCents: number, commissionRateBps: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(commissionRateBps)) return 0
  if (amountCents <= 0 || commissionRateBps <= 0) return 0
  // Commission can never exceed the underlying charge.
  return Math.floor((amountCents * Math.min(commissionRateBps, 10000)) / 10000)
}

export interface RecordCommissionInput {
  partnerId: string
  projectId: string | null
  amountCents: number // the underlying charge this commission is a percentage of
  commissionRateBps: number
  currency: string
  reason: string
  refId: string // must be unique per real-world billing event — enforces idempotency via the DB's UNIQUE(partner_id, ref_id)
}

export interface RecordCommissionResult {
  recorded: boolean // false if this event was already recorded, or the computed commission was 0
  commissionCents: number
}

export async function recordCommission(input: RecordCommissionInput): Promise<RecordCommissionResult> {
  const commissionCents = calculateCommissionCents(input.amountCents, input.commissionRateBps)
  if (commissionCents <= 0) return { recorded: false, commissionCents: 0 }

  const { data: lastEntry } = await supabaseAdmin
    .from('partner_commission_ledger')
    .select('balance_after_cents')
    .eq('partner_id', input.partnerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balanceAfter = (lastEntry?.balance_after_cents ?? 0) + commissionCents

  const { error } = await supabaseAdmin.from('partner_commission_ledger').insert({
    partner_id: input.partnerId,
    project_id: input.projectId,
    delta_cents: commissionCents,
    currency: input.currency,
    reason: input.reason,
    ref_id: input.refId,
    balance_after_cents: balanceAfter,
  })

  if (error) {
    // 23505 = unique_violation on (partner_id, ref_id) — this billing event was already
    // recorded (e.g. a duplicate/retried webhook delivery). Treat as success, not an error —
    // same idempotency convention used throughout the byrd fulfillment work.
    const code = (error as { code?: string }).code
    if (code === '23505') return { recorded: false, commissionCents: 0 }
    throw new Error(`Failed to record partner commission: ${error.message}`)
  }

  return { recorded: true, commissionCents }
}

// Looks up whether a project is currently assigned to an active partner, and if so
// returns what's needed to record a commission for it. Returns null for unassigned
// projects or projects assigned to a pending/suspended partner (no commission accrues
// until the partner is approved) — callers should silently skip in that case.
//
// SECURITY: also returns null when the partner IS the project owner or the paying user
// (`payerUserId`, e.g. hosting_subscriptions.user_id). Partners can currently only assign
// projects they own, so without this check every approved partner earned a standing
// kickback on their own hosting spend. Commission accrues only when a DIFFERENT account
// owns/pays for the project (the future referral model — partners.referral_code).
export async function getActivePartnerForProject(
  projectId: string,
  payerUserId?: string | null
): Promise<{ partnerId: string; commissionRateBps: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('partner_projects')
    .select('partner_id, status, partners!inner(id, status, commission_rate_bps, user_id), projects!inner(user_id)')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return null // fail closed — no commission on lookup errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  const partner = row.partners
  const projectOwnerId = row.projects?.user_id as string | undefined
  if (!partner || partner.status !== 'active') return null

  const partnerUserId = partner.user_id as string | undefined
  if (!partnerUserId || !projectOwnerId) return null
  if (partnerUserId === projectOwnerId) return null // self-owned project — no commission
  if (payerUserId && partnerUserId === payerUserId) return null // partner paying themselves

  const rate = Number(partner.commission_rate_bps)
  if (!Number.isInteger(rate) || rate <= 0 || rate > 10000) return null

  return { partnerId: partner.id as string, commissionRateBps: rate }
}
