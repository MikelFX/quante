// Marketplace — revenue-split calculation + the idempotent seller-ledger insert helper.
//
// SAFETY: same as lib/partner-commission.ts. This module records what a seller has EARNED
// from a purchase, as an append-only bookkeeping row. No real payment is ever collected or
// transferred here — see supabase/migration-marketplace.sql's header comment for the
// activation step this deliberately leaves undone.

import { supabaseAdmin } from './supabase/admin'

export const DEFAULT_PLATFORM_FEE_BPS = 2000 // 20% — Quante's cut, matches CLAUDE.md's "Quante si bere procento"

export interface RevenueSplit {
  priceCents: number
  platformFeeBps: number
  platformFeeCents: number
  sellerEarningCents: number
}

export function calculateRevenueSplit(priceCents: number, platformFeeBps: number = DEFAULT_PLATFORM_FEE_BPS): RevenueSplit {
  const safePrice = Number.isFinite(priceCents) && priceCents > 0 ? Math.floor(priceCents) : 0
  const safeBps = Number.isFinite(platformFeeBps) ? Math.min(Math.max(platformFeeBps, 0), 10000) : 0
  const platformFeeCents = Math.floor((safePrice * safeBps) / 10000)
  return {
    priceCents: safePrice,
    platformFeeBps: safeBps,
    platformFeeCents,
    sellerEarningCents: safePrice - platformFeeCents,
  }
}

export interface RecordSellerEarningInput {
  sellerUserId: string
  purchaseId: string // unique per purchase — enforces idempotency via the DB's UNIQUE(purchase_id)
  sellerEarningCents: number
  currency: string
}

export async function recordSellerEarning(input: RecordSellerEarningInput): Promise<{ recorded: boolean }> {
  if (input.sellerEarningCents <= 0) return { recorded: false }

  const { data: lastEntry } = await supabaseAdmin
    .from('marketplace_seller_ledger')
    .select('balance_after_cents')
    .eq('seller_user_id', input.sellerUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balanceAfter = (lastEntry?.balance_after_cents ?? 0) + input.sellerEarningCents

  const { error } = await supabaseAdmin.from('marketplace_seller_ledger').insert({
    seller_user_id: input.sellerUserId,
    purchase_id: input.purchaseId,
    delta_cents: input.sellerEarningCents,
    currency: input.currency,
    balance_after_cents: balanceAfter,
  })

  if (error) {
    // 23505 = unique_violation on purchase_id — already recorded (duplicate call/retry).
    const code = (error as { code?: string }).code
    if (code === '23505') return { recorded: false }
    throw new Error(`Failed to record seller earning: ${error.message}`)
  }

  return { recorded: true }
}
