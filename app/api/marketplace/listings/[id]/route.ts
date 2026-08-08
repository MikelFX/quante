// GET /api/marketplace/listings/[id]
// Listing detail. Never returns `snapshot` (the actual code) unless the caller is the
// seller or has already purchased it — that's the entire point of gating it behind a
// purchase. Anonymous/unauthenticated visitors can still view listed items' metadata.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()

  const { data: listing } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, kind, title, description, price_cents, currency, seller_user_id, status, created_at, snapshot')
    .eq('id', id)
    .maybeSingle()

  if (!listing) return Response.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.status !== 'listed' && listing.seller_user_id !== userId) {
    return Response.json({ error: 'Listing not found' }, { status: 404 })
  }

  let owned = listing.seller_user_id === userId
  if (!owned && userId) {
    const { data: purchase } = await supabaseAdmin
      .from('marketplace_purchases')
      .select('id')
      .eq('listing_id', id)
      .eq('buyer_user_id', userId)
      .maybeSingle()
    owned = !!purchase
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { snapshot, ...publicFields } = listing
  return Response.json({ listing: owned ? listing : publicFields, owned })
}
