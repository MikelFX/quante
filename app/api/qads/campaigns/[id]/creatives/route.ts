// POST /api/qads/campaigns/[id]/creatives — generate a static image creative for every
// ad in this campaign that doesn't have one yet. Separate from campaign creation
// (POST /api/qads/campaigns) because image generation is its own credit-metered,
// async-completing step (Higgsfield submit -> webhook), not part of the single strategy
// call — matches the job-graph shape in lib/qads/pipeline/graph.ts (ad_copy completes
// before image_prompts/images start).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { runImagesNode } from '@/lib/qads/pipeline/nodes/images'
import { reserveCredits, refundCredits, QADS_CREDIT_COSTS } from '@/lib/qads/credits'
import type { ShopAdBrandContext } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, brand_context, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (!campaign.brand_context) return NextResponse.json({ error: 'Campaign has no brand context yet' }, { status: 422 })

  const { data: adSets } = await supabaseAdmin.from('qads_ad_sets').select('id').eq('campaign_id', campaignId)
  const adSetIds = (adSets ?? []).map((s) => s.id as string)
  if (!adSetIds.length) return NextResponse.json({ error: 'Campaign has no ad sets yet' }, { status: 422 })

  const { data: pendingAds } = await supabaseAdmin
    .from('qads_ads')
    .select('id, format, texts')
    .in('ad_set_id', adSetIds)
    .is('creative_id', null)

  const ads = (pendingAds ?? []).map((ad) => ({
    adId: ad.id as string,
    format: ad.format as '1:1' | '4:5' | '9:16' | '16:9',
    texts: ad.texts as { headline: string; primaryText: string },
  }))

  if (!ads.length) {
    return NextResponse.json({ submitted: 0, failed: 0, message: 'Every ad already has a creative.' })
  }

  const cost = ads.length * QADS_CREDIT_COSTS.static_creative
  const reserveResult = await reserveCredits({ userId, amount: cost, campaignId })
  if (!reserveResult.ok) {
    return NextResponse.json(
      { error: 'Insufficient credits', needed: reserveResult.needed, balance: reserveResult.balance },
      { status: 402 },
    )
  }

  const result = await runImagesNode({
    campaignId,
    userId,
    brandContext: campaign.brand_context as ShopAdBrandContext,
    ads,
  })

  // runImagesNode already refunds per-asset failures individually (leaf-level, per
  // docs/qads-proposal.md §6) — this only refunds the gap between what we reserved
  // up front for `ads.length` assets and what actually got submitted, covering
  // whole-batch preconditions (no product photo, Higgsfield not configured) that fail
  // before any per-asset refund logic runs.
  const unaccountedFor = ads.length - result.submitted - result.failed
  if (unaccountedFor > 0) {
    await refundCredits({
      userId,
      amount: unaccountedFor * QADS_CREDIT_COSTS.static_creative,
      campaignId,
      reason: 'qads_creatives_batch_refund',
    })
  }

  if (!result.ok && result.submitted === 0) {
    return NextResponse.json({ error: result.error ?? 'image_generation_failed', submitted: 0, failed: result.failed }, { status: 500 })
  }

  return NextResponse.json({ submitted: result.submitted, failed: result.failed })
}
