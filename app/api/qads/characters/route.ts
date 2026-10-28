// /api/qads/characters — the Tiktoker "Character" (lib/qads/tiktoker.ts).
//   POST: a few traits (+ an optional note and product photo) → one Higgsfield AI Influencer
//         character sheet. Stored as a qads_generations row with style 'character' and one image
//         item, so the webhook, the sweep cron, refunds and the results grid work unchanged.
//   GET:  the caller's finished characters with a fresh signed URL each, newest first.
// Price: lib/qads/pricing.ts characterCredits() (at cost during the launch offer).

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { characterCredits, TIKTOKER_MODELS } from '@/lib/qads/pricing'
import { refundGeneratorCredits } from '@/lib/qads/credits'
import { failItemAndRefund } from '@/lib/qads/items'
import { buildQadsWebhookUrl } from '@/lib/qads/webhook-token'
import { isOwnQadsInputPath, signQadsInputPaths } from '@/lib/qads/inputs'
import { chargeQadsGeneration } from '@/lib/qads/charge'
import { CHARACTER_STYLE, buildCharacterRequestJson, cleanTraits, describeTraits } from '@/lib/qads/tiktoker'

export const maxDuration = 30

const BODY = z.object({
  traits: z.record(z.string(), z.string()).default({}),
  note: z.string().max(500).default(''),
  // Optional: the product the character will hold on the sheet.
  photoStoragePath: z.string().min(1).max(300).nullable().optional(),
})

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  let body: z.infer<typeof BODY>
  try {
    body = BODY.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body', code: 'bad_request' }, { status: 400 })
  }
  const traits = cleanTraits(body.traits)
  const photoPath = body.photoStoragePath ?? null
  if (photoPath && !isOwnQadsInputPath(userId, photoPath)) {
    return NextResponse.json({ error: 'Invalid photo path', code: 'bad_request' }, { status: 400 })
  }

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) return NextResponse.json({ error: 'Media provider not configured', code: 'provider_missing' }, { status: 500 })
  let photoUrl = ''
  if (photoPath) {
    const signed = await signQadsInputPaths([photoPath])
    if (!signed) return NextResponse.json({ error: 'Uploaded photo not found — please re-upload.', code: 'bad_request' }, { status: 400 })
    photoUrl = signed[0]
  }

  const credits = characterCredits()
  const generationId = randomUUID()
  const charge = await chargeQadsGeneration({ userId, generationId, credits, videos: 0, images: 1 })
  if (!charge.ok) return charge.response
  const charged = charge.agency ? 0 : credits

  const summary = describeTraits(traits) || 'Creator'
  const { error: genError } = await supabaseAdmin.from('qads_generations').insert({
    id: generationId,
    user_id: userId,
    project_id: null,
    product_name: `Character · ${summary}`.slice(0, 120),
    product_description: summary,
    input_photo_urls: photoPath ? [photoPath] : [],
    output_types: ['image'],
    formats: ['9:16'],
    style: CHARACTER_STYLE,
    variants_per_format: 1,
    video_duration_s: null,
    language: 'en',
    total_credits_reserved: charged,
    status: 'queued',
  })
  if (genError) {
    console.error('[qads/characters] generation insert failed:', genError.message)
    if (charged) await refundGeneratorCredits({ userId, generationId, reason: 'qads_generation_hard_failure' })
    return NextResponse.json({ error: 'Failed to save the character', code: 'db_error' }, { status: 500 })
  }

  const requestJson = buildCharacterRequestJson(traits, body.note)
  const { data: item, error: itemError } = await supabaseAdmin.from('qads_items').insert({
    generation_id: generationId,
    user_id: userId,
    kind: 'image',
    format: '9:16',
    variant_idx: 0,
    prompt_used: requestJson,
    higgsfield_model: TIKTOKER_MODELS.character.slug,
    status: 'queued',
    credits_charged: charged,
  }).select('id').single()
  if (itemError || !item) {
    console.error('[qads/characters] item insert failed:', itemError?.message)
    await supabaseAdmin.from('qads_generations').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', generationId)
    if (charged) await refundGeneratorCredits({ userId, generationId, reason: 'qads_generation_hard_failure' })
    return NextResponse.json({ error: 'Failed to save the character', code: 'db_error' }, { status: 500 })
  }

  const itemId = item.id as string
  try {
    const handle = await createHiggsfieldProvider(creds).submit({
      kind: 'image',
      mode: 'character',
      prompt: requestJson,
      format: '9:16',
      referenceImageUrl: photoUrl,
      webhookUrl: buildQadsWebhookUrl(itemId),
    })
    await supabaseAdmin.from('qads_items').update({
      higgsfield_request_id: handle.providerRequestId,
      higgsfield_status_url: handle.statusUrl,
      higgsfield_cancel_url: handle.cancelUrl ?? null,
      status: 'generating',
    }).eq('id', itemId).eq('status', 'queued')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'submit_failed'
    console.error(`[qads/characters] Higgsfield submit failed for item ${itemId}:`, message)
    await failItemAndRefund(
      { id: itemId, generation_id: generationId, user_id: userId, credits_charged: charged },
      { errorMessage: message, refundReason: 'qads_item_submit_failed' },
    )
    await supabaseAdmin.from('qads_generations').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', generationId)
    return NextResponse.json({ error: 'Could not start the character. Your credits were returned.', code: 'provider_failed' }, { status: 502 })
  }
  await supabaseAdmin.from('qads_generations').update({ status: 'generating' }).eq('id', generationId).eq('status', 'queued')

  return NextResponse.json({ generationId, status: 'generating', totalCredits: charged })
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: gens, error } = await supabaseAdmin
    .from('qads_generations')
    .select('id, product_description, status, created_at')
    .eq('user_id', userId)
    .eq('style', CHARACTER_STYLE)
    .order('created_at', { ascending: false })
    .limit(24)
  if (error) return NextResponse.json({ error: 'Failed to load characters' }, { status: 500 })
  const ids = (gens ?? []).map(g => g.id as string)
  if (!ids.length) return NextResponse.json({ characters: [] })

  const { data: items } = await supabaseAdmin
    .from('qads_items')
    .select('generation_id, status, storage_bucket, storage_path')
    .in('generation_id', ids)
  const byGen = new Map((items ?? []).map(i => [i.generation_id as string, i]))

  const characters = await Promise.all((gens ?? []).map(async g => {
    const it = byGen.get(g.id as string)
    let imageUrl: string | null = null
    if (it?.status === 'completed' && it.storage_bucket && it.storage_path) {
      const { data } = await supabaseAdmin.storage.from(it.storage_bucket as string).createSignedUrl(it.storage_path as string, 60 * 60)
      imageUrl = data?.signedUrl ?? null
    }
    return {
      id: g.id as string,
      summary: (g.product_description as string) ?? '',
      status: (it?.status as string | undefined) ?? (g.status as string),
      imageUrl,
      createdAt: g.created_at as string,
    }
  }))
  return NextResponse.json({ characters })
}
