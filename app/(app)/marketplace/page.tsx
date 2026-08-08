import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { MarketplaceBrowser } from './MarketplaceBrowser'

export interface MarketplaceListing {
  id: string
  kind: 'component' | 'starter_store'
  title: string
  description: string | null
  price_cents: number
  currency: string
  seller_user_id: string
  created_at: string
}

export default async function MarketplacePage() {
  const { userId } = await auth()

  const { data: listings } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, kind, title, description, price_cents, currency, seller_user_id, created_at')
    .eq('status', 'listed')
    .order('created_at', { ascending: false })
    .limit(60)

  let ownedListingIds: string[] = []
  if (userId) {
    const { data: purchases } = await supabaseAdmin
      .from('marketplace_purchases')
      .select('listing_id')
      .eq('buyer_user_id', userId)
    ownedListingIds = (purchases ?? []).map((p) => p.listing_id as string)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f4f4f6', margin: '0 0 6px' }}>Marketplace</h1>
      <p style={{ fontSize: 13, color: '#8a8a93', margin: '0 0 28px', lineHeight: 1.6 }}>
        Components and starter stores published by other Quante users. Buying installs a copy directly into one of your projects.
      </p>
      <MarketplaceBrowser
        initialListings={(listings ?? []) as MarketplaceListing[]}
        ownedListingIds={ownedListingIds}
        isSignedIn={!!userId}
      />
    </div>
  )
}
