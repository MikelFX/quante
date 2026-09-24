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
      <p style={{ fontSize: 13, color: '#8a8a93', margin: '0 0 12px', lineHeight: 1.6 }}>
        Components and starter stores published by other Quante users. Installing adds a copy directly into one of your projects.
      </p>
      <p style={{ fontSize: 12, color: '#5b5b64', margin: '0 0 28px', lineHeight: 1.6, padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.02)' }}>
        Paid purchases are coming soon — for now only free listings can be installed.
        Selling? Free components that pass validation are listed right away; paid listings and starter stores go to review first and appear here once approved.
      </p>
      <MarketplaceBrowser
        initialListings={(listings ?? []) as MarketplaceListing[]}
        ownedListingIds={ownedListingIds}
        isSignedIn={!!userId}
      />
    </div>
  )
}
