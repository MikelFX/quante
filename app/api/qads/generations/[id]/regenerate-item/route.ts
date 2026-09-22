// POST /api/qads/generations/[id]/regenerate-item — re-run one item using
// the same prompt Claude wrote originally. Costs the same as a fresh item
// of that kind (see lib/qads/pricing.ts creditsPerItem). Debits the user
// synchronously and fires a new Higgsfield submit; the webhook path is the
// same as first-time generation.
//
// This is the "Vygenerovat znovu" affordance on a single failed or unwanted
// variant tile — cheaper for the user than resubmitting the whole
// generation.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { reserveGeneratorCredits, refundGeneratorCredits, getCreditBalance } from '@/lib/qads/credits'
import { creditsPerItem } from '@/lib/qads/pricing'
import type { MediaGenerationInput } from '@/lib/qads/media/types'

export const maxDuration = 30

const BODY_SCHEMA = z.object({
  itemId: z.string().uuid(),
})

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: generationId } = await ctx.params

  let itemId: string
  try {
    const raw = await request.json()
    itemId = BODY_SCHEMA.parse(raw).itemId
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const [{ data: generation }, { data: item }] = await Promise.all([
    supabaseAdmin.from('qads_generations').select('*').eq('id', generationId).eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('qads_items').select('*').eq('id', itemId).eq('generation_id', generationId).eq('user_id', userId).maybeSingle(),
  ])
  if (!generation || !item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Cost matches the original item's kind + the generation's video duration.
  const kind = item.kind as 'image' | 'video'
  const cost = creditsPerItem(kind, generation.video_duration_s ?? 0)
  const balance = await getCreditBalance(userId)
  if (balance < cost) {
    return NextResponse.json(
      { error: 'insufficient_credits', balance, needed: cost },
      { status: 402 },
    )
  }
  const reserve = await reserveGeneratorCredits({ userId, amount: cost, generationId })
  if (!reserve.ok) return NextResponse.json({ error: reserve.error, balance: reserve.balance, needed: reserve.needed }, { status: 402 })

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) {
    await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_higgsfield_not_configured' })
    return NextResponse.json({ error: 'Provider not configured' }, { status: 500 })
  }
  const provider = createHiggsfieldProvider(creds)

  const webhookBase = process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET || ''
  // We need the original signed URL for the reference photo — re-sign it now
  // from the generation's stored photo storage_path.
  const paths = (generation.input_photo_urls as string[]) ?? []
  const primaryPath = paths[0]
  if (!primaryPath) {
    await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_missing_input_photo' })
    return NextResponse.json({ error: 'Original photo unavailable' }, { status: 500 })
  }
  const { data: signed, error: signErr } = await supabaseAdmin.storage.from('qads-inputs').createSignedUrl(primaryPath, 60 * 60 * 2)
  if (signErr || !signed?.signedUrl) {
    await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_input_signing_failed' })
    return NextResponse.json({ error: 'Failed to load input photo' }, { status: 500 })
  }
  const modelImagePath = paths[1]
  const modelImageUrl = modelImagePath
    ? (await supabaseAdmin.storage.from('qads-inputs').createSignedUrl(modelImagePath, 60 * 60 * 2)).data?.signedUrl
    : undefined

  const webhookUrl = webhookBase && webhookSecret
    ? `${webhookBase}/api/webhooks/higgsfield?item=${itemId}&s=${webhookSecret}`
    : undefined

  const submitInput: MediaGenerationInput = {
    kind,
    prompt: item.prompt_used as string,
    format: item.format as '1:1'|'4:5'|'9:16'|'16:9',
    referenceImageUrl: signed.signedUrl,
    modelImageUrl,
    webhookUrl,
  }
  try {
    const handle = await provider.submit(submitInput)
    await supabaseAdmin.from('qads_items').update({
      higgsfield_request_id: handle.providerRequestId,
      higgsfield_status_url: handle.statusUrl,
      higgsfield_cancel_url: handle.cancelUrl ?? null,
      status: 'generating',
      storage_bucket: null,
      storage_path: null,
      mime_type: null,
      error_message: null,
      completed_at: null,
      credits_charged: cost,
    }).eq('id', itemId)
    return NextResponse.json({ ok: true, itemId, higgsfieldRequestId: handle.providerRequestId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'submit_failed'
    console.error(`[qads/regenerate-item] Higgsfield submit failed for item ${itemId}:`, message)
    await supabaseAdmin.from('qads_items').update({ status: 'failed', error_message: message.slice(0, 500), completed_at: new Date().toISOString() }).eq('id', itemId)
    await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_item_submit_failed' })
    return NextResponse.json({ error: 'Submit failed' }, { status: 502 })
  }
}
