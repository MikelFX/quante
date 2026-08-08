// GET /api/marketplace/mine
// The calling user's own listings (any status, including pending review), their recent
// seller-earnings ledger + running balance, and what they've purchased as a buyer.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [listingsResult, ledgerResult, purchasesResult] = await Promise.all([
    supabaseAdmin
      .from('marketplace_listings')
      .select('id, kind, title, description, price_cents, currency, status, passed_validation, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('marketplace_seller_ledger')
      .select('id, purchase_id, delta_cents, currency, status, balance_after_cents, created_at')
      .eq('seller_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('marketplace_purchases')
      .select('id, listing_id, price_cents, currency, target_project_id, created_at, marketplace_listings(title, kind)')
      .eq('buyer_user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  const balanceCents = ledgerResult.data?.[0]?.balance_after_cents ?? 0

  return Response.json({
    listings: listingsResult.data ?? [],
    ledger: ledgerResult.data ?? [],
    balanceCents,
    purchases: purchasesResult.data ?? [],
  })
}
