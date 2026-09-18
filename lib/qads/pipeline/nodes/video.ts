// Mirrors images.ts exactly for video creative: one Seedance 2.5 Reference-To-Video
// request per ad, via the same MediaProvider.submit({kind:'video', ...}) call — the
// provider-agnostic interface (lib/qads/media/types.ts) is what makes this a near-
// duplicate of images.ts rather than a different code path per model. Same Phase-1
// simplification as images.ts: every video in a campaign depicts the campaign's primary
// product until per-ad product assignment exists (step j).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createMediaProvider } from '../../media/registry'
import { getHiggsfieldCredentialsFromEnv } from '../../media/providers/higgsfield'
import { runVideoPromptsNode } from './video-prompts'
import { refundCredits, QADS_CREDIT_COSTS } from '../../credits'
import type { ShopAdBrandContext } from '../../types'
import type { ImagesNodeAdInput } from './images'

export interface RunVideoNodeResult {
  ok: boolean
  submitted: number
  failed: number
  error?: string
}

export async function runVideoNode(params: {
  campaignId: string
  userId: string
  brandContext: ShopAdBrandContext
  ads: ImagesNodeAdInput[]
}): Promise<RunVideoNodeResult> {
  const { campaignId, userId, brandContext, ads } = params

  const primaryProduct = brandContext.products[0]
  if (!primaryProduct) {
    return { ok: false, submitted: 0, failed: 0, error: 'no_product_available_for_creative' }
  }

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) {
    console.error('[qads/video] HIGGSFIELD_API_KEY_ID/SECRET not configured — skipping video generation')
    return { ok: false, submitted: 0, failed: 0, error: 'higgsfield_not_configured' }
  }

  const promptsResult = await runVideoPromptsNode({
    brandContext,
    ads: ads.map((ad) => ({
      adId: ad.adId,
      format: ad.format,
      texts: ad.texts,
      productName: primaryProduct.name,
      productDescription: primaryProduct.description,
    })),
  })
  if (!promptsResult.ok) {
    return { ok: false, submitted: 0, failed: 0, error: promptsResult.error }
  }
  const promptByAdId = new Map(promptsResult.prompts.map((p) => [p.adId, p.prompt]))

  const provider = createMediaProvider('higgsfield', creds)
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/higgsfield`
    : undefined

  let submitted = 0
  let failed = 0

  for (const ad of ads) {
    const prompt = promptByAdId.get(ad.adId)
    if (!prompt) {
      console.warn(`[qads/video] no generated prompt for ad ${ad.adId}, skipping`)
      failed++
      continue
    }

    const { data: creative, error: insertError } = await supabaseAdmin
      .from('qads_creatives')
      .insert({
        campaign_id: campaignId,
        type: 'video',
        format: ad.format,
        status: 'queued',
        provider: 'higgsfield',
        input_params: { prompt, referenceImageUrl: primaryProduct.images[0] ?? null },
        source_product_id: primaryProduct.id,
      })
      .select('id')
      .single()

    if (insertError || !creative) {
      console.error(`[qads/video] failed to insert creative row for ad ${ad.adId}:`, insertError?.message)
      failed++
      continue
    }

    if (!primaryProduct.images[0]) {
      await supabaseAdmin.from('qads_creatives').update({ status: 'failed', error: 'primary product has no photo to use as a reference image' }).eq('id', creative.id)
      await refundCredits({ userId, amount: QADS_CREDIT_COSTS.video_creative, campaignId, reason: 'qads_video_failed_no_reference_image' })
      failed++
      continue
    }

    try {
      const handle = await provider.submit({
        kind: 'video',
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
      console.error(`[qads/video] submit failed for ad ${ad.adId}:`, message)
      await supabaseAdmin.from('qads_creatives').update({ status: 'failed', error: message }).eq('id', creative.id)
      await refundCredits({ userId, amount: QADS_CREDIT_COSTS.video_creative, campaignId, reason: 'qads_video_submit_failed' })
      failed++
    }
  }

  return { ok: submitted > 0 || ads.length === 0, submitted, failed }
}
