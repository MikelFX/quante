// POST /api/webhooks/higgsfield — completion callback for Higgsfield generation
// requests (configured via the hf_webhook query param at submit time, see
// lib/qads/media/providers/higgsfield/client.ts). Per docs.higgsfield.ai/docs/how-to/
// webhooks: must respond within 10 seconds, 2xx acks a delivery, 4xx is treated as
// permanent (not retried), duplicate deliveries are possible and must be deduplicated.
//
// NO SIGNATURE VERIFICATION — flagged explicitly, not an oversight. Higgsfield's
// documented webhook contract (fetched from docs.higgsfield.ai during this
// implementation step) describes the payload envelope and delivery/retry semantics but
// does NOT document any HMAC/signature header scheme. The only verification available is
// therefore checking that `request_id` matches a request WE actually issued (a
// provider_request_id we stored on a qads_creatives row) — an unknown request_id is
// rejected. This is weaker than signature verification and relies partly on the
// webhook URL not being guessable; revisit if Higgsfield later documents a signing
// scheme (docs/qads-proposal.md-style open item, tracked here rather than silently
// assumed away).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseHiggsfieldWebhook } from '@/lib/qads/media/providers/higgsfield/mapper'
import { refundCredits, QADS_CREDIT_COSTS } from '@/lib/qads/credits'

export const maxDuration = 30

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    // Malformed body is a permanent problem, not a transient one — 4xx per docs.
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseHiggsfieldWebhook(body)
  if (!parsed) {
    return NextResponse.json({ error: 'Envelope does not match the documented webhook shape' }, { status: 400 })
  }

  const { providerRequestId, result } = parsed

  const { data: creative } = await supabaseAdmin
    .from('qads_creatives')
    .select('id, campaign_id, status, format')
    .eq('provider_request_id', providerRequestId)
    .maybeSingle()

  if (!creative) {
    // Unknown request_id — either a delivery for a request this environment never
    // issued (wrong webhook URL configured against a different Quante deployment) or a
    // spoofed delivery. Reject rather than silently accept, per the no-signature note
    // above; 404 rather than 400 since the envelope itself was valid.
    console.warn(`[webhooks/higgsfield] no qads_creatives row for request_id ${providerRequestId}`)
    return NextResponse.json({ error: 'Unknown request_id' }, { status: 404 })
  }

  // Dedup: a creative already in a terminal state has already been processed by an
  // earlier delivery of this same event — ack without reprocessing (avoids a double
  // asset upload or a double refund on a retried 'failed' delivery).
  if (['completed', 'failed', 'flagged_for_review'].includes(creative.status)) {
    return NextResponse.json({ ok: true, deduped: true })
  }

  if (result.status === 'completed' && result.assets?.length) {
    const asset = result.assets[0]
    try {
      const assetId = await copyAssetToStorage({ campaignId: creative.campaign_id, sourceUrl: asset.url, contentType: asset.contentType })
      await supabaseAdmin.from('qads_creatives').update({
        status: 'completed',
        asset_id: assetId,
        updated_at: new Date().toISOString(),
      }).eq('id', creative.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to copy asset to storage'
      console.error(`[webhooks/higgsfield] ${message}`)
      await markFailedAndRefund(creative.id, creative.campaign_id, message)
    }
  } else if (result.status === 'nsfw') {
    await supabaseAdmin.from('qads_creatives').update({
      status: 'flagged_for_review',
      error: 'Rejected by Higgsfield content moderation',
      updated_at: new Date().toISOString(),
    }).eq('id', creative.id)
    await refundForCampaign(creative.campaign_id, QADS_CREDIT_COSTS.static_creative, 'qads_creative_nsfw_refund')
  } else if (result.status === 'failed' || result.status === 'canceled') {
    await markFailedAndRefund(creative.id, creative.campaign_id, result.error ?? `Higgsfield reported status: ${result.status}`)
  }
  // 'queued' / 'in_progress' deliveries shouldn't normally arrive as webhook events
  // (webhooks fire on terminal states per the docs) but are acked harmlessly if they do.

  return NextResponse.json({ ok: true })
}

async function markFailedAndRefund(creativeId: string, campaignId: string, error: string): Promise<void> {
  await supabaseAdmin.from('qads_creatives').update({
    status: 'failed',
    error,
    updated_at: new Date().toISOString(),
  }).eq('id', creativeId)
  await refundForCampaign(campaignId, QADS_CREDIT_COSTS.static_creative, 'qads_creative_generation_failed')
}

async function refundForCampaign(campaignId: string, amount: number, reason: string): Promise<void> {
  const { data: campaign } = await supabaseAdmin.from('qads_campaigns').select('user_id').eq('id', campaignId).maybeSingle()
  if (!campaign) return
  await refundCredits({ userId: campaign.user_id as string, amount, campaignId, reason })
}

// Higgsfield's own output URLs are only retained "at least seven days" (per
// docs.higgsfield.ai) — copying into Supabase Storage immediately on completion is
// mandatory durability, not optional caching. Kept deliberately simple (fetch + reupload,
// no transcoding) since Marketing Studio Image outputs are already campaign-ready; must
// complete within Higgsfield's 10-second webhook response window, which a single image
// fetch/upload comfortably fits.
async function copyAssetToStorage(params: { campaignId: string; sourceUrl: string; contentType?: string }): Promise<string> {
  const { campaignId, sourceUrl, contentType } = params
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Failed to fetch generated asset: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const mimeType = contentType || res.headers.get('content-type') || 'image/jpeg'
  const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg'
  const path = `${campaignId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from('qads-assets')
    .upload(path, buffer, { contentType: mimeType, upsert: false })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  const { data: urlData } = supabaseAdmin.storage.from('qads-assets').getPublicUrl(path)

  const { data: assetRow, error: insertError } = await supabaseAdmin
    .from('qads_assets')
    .insert({
      project_id: await getProjectIdForCampaign(campaignId),
      storage_path: path,
      mime_type: mimeType,
      bytes: buffer.byteLength,
    })
    .select('id')
    .single()
  if (insertError || !assetRow) throw new Error(`qads_assets insert failed: ${insertError?.message}`)

  void urlData // public URL is derivable from storage_path on read; not stored redundantly on the row
  return assetRow.id
}

async function getProjectIdForCampaign(campaignId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('qads_campaigns').select('project_id').eq('id', campaignId).single()
  return data?.project_id as string
}
