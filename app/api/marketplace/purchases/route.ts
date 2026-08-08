// POST /api/marketplace/purchases   { listingId, targetProjectId }
//
// SAFETY: this endpoint does NOT charge any real payment method. It records the purchase +
// seller-earning bookkeeping (mirroring how credit-pack purchases are recorded today) and
// installs a copy of the snapshot into the buyer's chosen project. In production this
// should be called only after a real charge succeeds (e.g. from a Stripe webhook, the same
// way credit purchases work in app/api/stripe/webhook/route.ts) — that wiring is the
// deliberate activation step left for the user; see migration-marketplace.sql.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateRevenueSplit, recordSellerEarning, DEFAULT_PLATFORM_FEE_BPS } from '@/lib/marketplace'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const listingId = body.listingId
  const targetProjectId = body.targetProjectId
  if (typeof listingId !== 'string' || typeof targetProjectId !== 'string') {
    return Response.json({ error: 'listingId and targetProjectId are required' }, { status: 400 })
  }

  const { data: listing } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, kind, title, seller_user_id, price_cents, currency, status, snapshot')
    .eq('id', listingId)
    .maybeSingle()
  if (!listing || listing.status !== 'listed') {
    return Response.json({ error: 'Listing not available' }, { status: 404 })
  }
  if (listing.seller_user_id === userId) {
    return Response.json({ error: 'You cannot purchase your own listing' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, user_id')
    .eq('id', targetProjectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return Response.json({ error: 'Target project not found' }, { status: 404 })

  const { data: existing } = await supabaseAdmin
    .from('marketplace_purchases')
    .select('id')
    .eq('listing_id', listingId)
    .eq('buyer_user_id', userId)
    .maybeSingle()
  if (existing) return Response.json({ error: 'You already purchased this listing', purchaseId: existing.id }, { status: 409 })

  const split = calculateRevenueSplit(listing.price_cents, DEFAULT_PLATFORM_FEE_BPS)

  const { data: purchase, error: purchaseError } = await supabaseAdmin
    .from('marketplace_purchases')
    .insert({
      listing_id: listingId,
      buyer_user_id: userId,
      seller_user_id: listing.seller_user_id,
      target_project_id: targetProjectId,
      price_cents: split.priceCents,
      currency: listing.currency,
      platform_fee_bps: split.platformFeeBps,
      platform_fee_cents: split.platformFeeCents,
      seller_earning_cents: split.sellerEarningCents,
    })
    .select('id')
    .single()

  if (purchaseError || !purchase) {
    // 23505 on (listing_id, buyer_user_id) races with the existing-check above — treat as
    // "already purchased" rather than a hard error.
    const code = (purchaseError as { code?: string } | null)?.code
    if (code === '23505') return Response.json({ error: 'You already purchased this listing' }, { status: 409 })
    return Response.json({ error: purchaseError?.message ?? 'Failed to record purchase' }, { status: 500 })
  }

  if (split.sellerEarningCents > 0) {
    await recordSellerEarning({
      sellerUserId: listing.seller_user_id,
      purchaseId: purchase.id,
      sellerEarningCents: split.sellerEarningCents,
      currency: listing.currency,
    })
  }

  const installResult = await installListing(listing, targetProjectId, userId)
  return Response.json({ purchase: { id: purchase.id, ...split }, install: installResult }, { status: 201 })
}

interface ListingRow {
  kind: string
  title: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: any
}

async function installListing(listing: ListingRow, targetProjectId: string, buyerUserId: string) {
  if (listing.kind === 'component') {
    const ref = `market-${crypto.randomUUID().slice(0, 8)}`
    const { error } = await supabaseAdmin.from('custom_components').insert({
      project_id: targetProjectId,
      ref,
      name: listing.snapshot.name ?? listing.title,
      code: listing.snapshot.code,
      prompt: `Purchased from marketplace: ${listing.title}`,
      passed_validation: true, // marketplace only lists components that already passed validation at publish time
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, ref }
  }

  // kind === 'starter_store'
  const { data: current } = await supabaseAdmin
    .from('code_versions')
    .select('version_no')
    .eq('project_id', targetProjectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabaseAdmin.from('code_versions').insert({
    project_id: targetProjectId,
    user_id: buyerUserId,
    version_no: (current?.version_no ?? 0) + 1,
    files: listing.snapshot.files,
    prompt: `Installed starter store from marketplace: ${listing.title}`,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
