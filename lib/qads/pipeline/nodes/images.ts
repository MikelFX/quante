// Submits one Higgsfield Marketing Studio Image request per ad needing a static
// creative, and persists the qads_creatives row that tracks it. Completion is async —
// this node only gets requests INTO flight; app/api/webhooks/higgsfield/route.ts (or a
// future polling cron, per the "webhooks with polling as fallback" requirement) is what
// marks a creative completed/failed once Higgsfield finishes.
//
// Phase-1 simplification, flagged explicitly: qads_ads has no per-ad product reference
// (the strategy call links ads to ad sets/angles, not to a specific store product — see
// lib/qads/claude/prompts.ts STRATEGY_SYSTEM_PROMPT). Every creative in this pass depicts
// the campaign's PRIMARY product (brand_context.products[0]) rather than a per-ad choice.
// That's a reasonable default for single-hero-product campaigns (the common "launch" /
// "sale" case) but a real limitation for multi-product campaigns — assigning a specific
// product per ad/ad-set is left for the CampaignTree UI in step (j), which is where a
// merchant would actually want to make that choice rather than have it auto-derived.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createMediaProvider } from '../../media/registry'
import { getHiggsfieldCredentialsFromEnv } from '../../media/providers/higgsfield'
import { runImagePromptsNode, type ImagePromptAdInput } from './image-prompts'
import { refundCredits, QADS_CREDIT_COSTS } from '../../credits'
import type { ShopAdBrandContext } from '../../types'

export interface ImagesNodeAdInput {
  adId: string
  format: '1:1' | '4:5' | '9:16' | '16:9'
  texts: { headline: string; primaryText: string }
}

export interface RunImagesNodeResult {
  ok: boolean
  submitted: number
  failed: number
  error?: string
}

export async function runImagesNode(params: {
  campaignId: string
  userId: string
  brandContext: ShopAdBrandContext
  ads: ImagesNodeAdInput[]
}): Promise<RunImagesNodeResult> {
  const { campaignId, userId, brandContext, ads } = params

  const primaryProduct = brandContext.products[0]
  if (!primaryProduct) {
    // No product to depict — this is a real precondition, not a transient failure.
    // Distinct from a Higgsfield API failure so callers/UI can explain it correctly.
    return { ok: false, submitted: 0, failed: 0, error: 'no_product_available_for_creative' }
  }

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) {
    console.error('[qads/images] HIGGSFIELD_API_KEY_ID/SECRET not configured — skipping image generation')
    return { ok: false, submitted: 0, failed: 0, error: 'higgsfield_not_configured' }
  }

  const promptInputs: ImagePromptAdInput[] = ads.map((ad) => ({
    adId: ad.adId,
    format: ad.format,
    texts: ad.texts,
    productName: primaryProduct.name,
    productDescription: primaryProduct.description,
  }))

  const promptsResult = await runImagePromptsNode({ brandContext, ads: promptInputs })
  if (!promptsResult.ok) {
    return { ok: false, submitted: 0, failed: 0, error: promptsResult.error }
  }
  const promptByAdId = new Map(promptsResult.prompts.map((p) => [p.adId, p.prompt]))

  const provider = createMediaProvider('higgsfield', creds)
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/higgsfield`
    : undefined
  if (!webhookUrl) {
    console.warn('[qads/images] NEXT_PUBLIC_APP_URL not set — submitting without a webhook, generation will only complete via a future polling pass')
  }

  let submitted = 0
  let failed = 0

  for (const ad of ads) {
    const prompt = promptByAdId.get(ad.adId)
    if (!prompt) {
      console.warn(`[qads/images] no generated prompt for ad ${ad.adId}, skipping`)
      failed++
      continue
    }

    const { data: creative, error: insertError } = await supabaseAdmin
      .from('qads_creatives')
      .insert({
        campaign_id: campaignId,
        type: 'static',
        format: ad.format,
        status: 'queued',
        provider: 'higgsfield',
        input_params: { prompt, referenceImageUrl: primaryProduct.images[0] ?? null },
        source_product_id: primaryProduct.id,
      })
      .select('id')
      .single()

    if (insertError || !creative) {
      console.error(`[qads/images] failed to insert creative row for ad ${ad.adId}:`, insertError?.message)
      failed++
      continue
    }

    if (!primaryProduct.images[0]) {
      await supabaseAdmin.from('qads_creatives').update({ status: 'failed', error: 'primary product has no photo to use as a reference image' }).eq('id', creative.id)
      await refundCredits({ userId, amount: QADS_CREDIT_COSTS.static_creative, campaignId, reason: 'qads_creative_failed_no_reference_image' })
      failed++
      continue
    }

    try {
      const handle = await provider.submit({
        kind: 'image',
        prompt,
        format: ad.format,
        referenceImageUrl: primaryProduct.images[0],
        webhookUrl,
      })

      await supabaseAdmin.from('qads_creatives').update({
        status: 'generating',
        provider_request_id: handle.providerRequestId,
        input_params: { prompt, referenceImageUrl: primaryProduct.images[0], statusUrl: handle.statusUrl, cancelUrl: handle.cancelUrl },
      }).eq('id', creative.id)

      await supabaseAdmin.from('qads_ads').update({ creative_id: creative.id }).eq('id', ad.adId)

      submitted++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'higgsfield submit failed'
      console.error(`[qads/images] submit failed for ad ${ad.adId}:`, message)
      await supabaseAdmin.from('qads_creatives').update({ status: 'failed', error: message }).eq('id', creative.id)
      // Leaf-level refund — this one asset's credit only, never the whole campaign
      // (docs/qads-proposal.md §6: "vrácení za neúspěšné assety").
      await refundCredits({ userId, amount: QADS_CREDIT_COSTS.static_creative, campaignId, reason: 'qads_creative_submit_failed' })
      failed++
    }
  }

  return { ok: submitted > 0 || ads.length === 0, submitted, failed }
}
