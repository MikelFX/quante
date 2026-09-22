// POST /api/qads/generate — the main entry point for the /qads generator.
// Flow (all inline, no queue):
//   1. Auth + zod-validate the form payload
//   2. Compute total cost from lib/qads/pricing.ts, check the user has enough
//      credits (short-circuit with a 402-style error if not)
//   3. Single Claude call to produce the image prompts + video prompts + ad
//      copy bundle (deterministic JSON, validated with zod)
//   4. Insert one qads_generations row + one qads_items row per (kind, format,
//      variant) slot + one qads_ad_copy row per (format, variant) slot
//   5. Reserve credits (atomic in the credit_ledger sense — mirrors
//      quante/iterate)
//   6. Fire Higgsfield submits per item with a small parallelism cap; on
//      each success, update the item with request_id + status_url and flip
//      status → generating. On each submit failure, refund that item's
//      credits and flip status → failed.
//   7. Return {generationId, status} immediately. The client polls
//      GET /api/qads/generations/:id for progress; the webhook fills in the
//      Higgsfield-generated assets as they arrive.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { anthropic, MODELS } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { HIGGSFIELD_MODELS, computeGeneratorCost, creditsPerItem, type HiggsfieldOutputKind } from '@/lib/qads/pricing'
import { reserveGeneratorCredits, getCreditBalance, refundGeneratorCredits } from '@/lib/qads/credits'
import { QADS_STYLE_IDS, getQadsStyle, isValidStyleId, type QadsStyleId } from '@/lib/qads/styles'
import {
  GENERATOR_SYSTEM_PROMPT,
  GeneratorPromptOutputSchema,
  buildGeneratorUserMessage,
  type GeneratorPromptOutput,
} from '@/lib/qads/claude/generator-prompts'
import type { MediaGenerationInput } from '@/lib/qads/media/types'

export const maxDuration = 60

const REQUEST_SCHEMA = z.object({
  productName: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().max(2000).default(''),
  photoStoragePaths: z.array(z.string().min(1)).min(1).max(4),
  photoSignedUrls: z.array(z.string().url()).min(1).max(4),
  projectId: z.string().uuid().nullable().optional(),
  outputTypes: z.array(z.enum(['image', 'video'])).min(1).max(2),
  formats: z.array(z.enum(['1:1', '4:5', '9:16', '16:9'])).min(1).max(4),
  style: z.string().refine(isValidStyleId, { message: 'Unknown style' }),
  variantsPerFormat: z.number().int().min(1).max(4),
  videoDurationSeconds: z.number().int().min(4).max(30).nullable().optional(),
  language: z.enum(['cs', 'en', 'sk', 'de']),
})

type ValidatedRequest = z.infer<typeof REQUEST_SCHEMA>

// How many concurrent Higgsfield submits to fire per generation. Small enough
// to stay clear of any per-account rate limit; large enough that a 16-item
// generation submits in a few seconds rather than serially.
const HIGGSFIELD_SUBMIT_CONCURRENCY = 6

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  // ── 1. Validate ──
  let parsed: ValidatedRequest
  try {
    const raw = await request.json()
    parsed = REQUEST_SCHEMA.parse(raw)
  } catch (err) {
    const detail = err instanceof z.ZodError
      ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      : 'Invalid request body'
    return NextResponse.json({ error: detail, code: 'bad_request' }, { status: 400 })
  }
  if (parsed.photoStoragePaths.length !== parsed.photoSignedUrls.length) {
    return NextResponse.json({ error: 'photoStoragePaths and photoSignedUrls must be equal length', code: 'bad_request' }, { status: 400 })
  }
  if (parsed.outputTypes.includes('video') && !parsed.videoDurationSeconds) {
    return NextResponse.json({ error: 'videoDurationSeconds is required when video output is requested', code: 'bad_request' }, { status: 400 })
  }
  if (parsed.projectId) {
    const { data: project } = await supabaseAdmin.from('projects').select('user_id').eq('id', parsed.projectId).maybeSingle()
    if (!project || project.user_id !== userId) {
      return NextResponse.json({ error: 'Project not found', code: 'bad_request' }, { status: 400 })
    }
  }

  // ── 2. Cost + balance ──
  const cost = computeGeneratorCost({
    outputTypes: parsed.outputTypes as HiggsfieldOutputKind[],
    formats: parsed.formats,
    variantsPerFormat: parsed.variantsPerFormat,
    videoDurationSeconds: parsed.videoDurationSeconds ?? 0,
  })
  const balance = await getCreditBalance(userId)
  if (balance < cost.totalCredits) {
    return NextResponse.json(
      { error: 'insufficient_credits', code: 'insufficient_credits', balance, needed: cost.totalCredits },
      { status: 402 },
    )
  }

  // ── 3. Claude — one bulk call for every prompt + all ad copy ──
  const style = getQadsStyle(parsed.style as QadsStyleId)
  const wantImages = parsed.outputTypes.includes('image')
  const wantVideos = parsed.outputTypes.includes('video')
  let claudeBundle: GeneratorPromptOutput
  try {
    const userMessage = buildGeneratorUserMessage({
      productName: parsed.productName,
      productDescription: parsed.productDescription,
      productPhotoUrls: parsed.photoSignedUrls,
      style,
      formats: parsed.formats,
      variantsPerFormat: parsed.variantsPerFormat,
      wantImages,
      wantVideos,
      videoDurationSeconds: parsed.videoDurationSeconds ?? 0,
      language: parsed.language,
    })
    const response = await anthropic.messages.create({
      model: MODELS.generation,
      max_tokens: 8000,
      system: GENERATOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text content')
    const jsonStr = stripJsonFences(textBlock.text)
    const parsedBundle = JSON.parse(jsonStr)
    claudeBundle = GeneratorPromptOutputSchema.parse(parsedBundle)
  } catch (err) {
    console.error('[qads/generate] Claude bundle failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Failed to generate prompts + ad copy. Please try again.', code: 'claude_failed' },
      { status: 502 },
    )
  }

  // Verify the bundle has an entry for every requested slot — a malformed
  // Claude response with missing slots would silently produce a half-empty
  // generation with unmatched refunds; better to fail before reserving.
  const expectedSlots = new Set<string>()
  for (const format of parsed.formats) {
    for (let v = 0; v < parsed.variantsPerFormat; v++) {
      expectedSlots.add(`${format}:${v}`)
    }
  }
  const hasAllCopy = expectedSlots.size === new Set(claudeBundle.adCopy.map(a => `${a.format}:${a.variantIdx}`)).size
  const hasAllImagePrompts = !wantImages || expectedSlots.size === new Set(claudeBundle.imagePrompts.map(p => `${p.format}:${p.variantIdx}`)).size
  const hasAllVideoPrompts = !wantVideos || expectedSlots.size === new Set(claudeBundle.videoPrompts.map(p => `${p.format}:${p.variantIdx}`)).size
  if (!hasAllCopy || !hasAllImagePrompts || !hasAllVideoPrompts) {
    return NextResponse.json(
      { error: 'Prompt bundle was missing slots. Please try again.', code: 'claude_incomplete' },
      { status: 502 },
    )
  }

  // ── 4. Persist generation + items + ad copy ──
  const { data: generation, error: genError } = await supabaseAdmin.from('qads_generations').insert({
    user_id: userId,
    project_id: parsed.projectId ?? null,
    product_name: parsed.productName,
    product_description: parsed.productDescription,
    input_photo_urls: parsed.photoStoragePaths, // storage paths, not signed URLs
    output_types: parsed.outputTypes,
    formats: parsed.formats,
    style: parsed.style,
    variants_per_format: parsed.variantsPerFormat,
    video_duration_s: parsed.videoDurationSeconds ?? null,
    language: parsed.language,
    total_credits_reserved: cost.totalCredits,
    status: 'queued',
  }).select('id').single()
  if (genError || !generation) {
    console.error('[qads/generate] qads_generations insert failed:', genError?.message)
    return NextResponse.json({ error: 'Failed to persist generation', code: 'db_error' }, { status: 500 })
  }
  const generationId = generation.id as string

  // Ad copy rows — one per (format, variantIdx, language) slot.
  const copyRows = claudeBundle.adCopy.map(c => ({
    generation_id: generationId,
    user_id: userId,
    format: c.format,
    variant_idx: c.variantIdx,
    language: parsed.language,
    hook: c.hook,
    primary_text: c.primaryText,
    headline: c.headline,
    cta: c.cta,
    video_script: c.videoScript ?? null,
    subtitles: c.subtitles ?? null,
  }))
  const { error: copyError } = await supabaseAdmin.from('qads_ad_copy').insert(copyRows)
  if (copyError) {
    console.error('[qads/generate] qads_ad_copy insert failed:', copyError.message)
    // Ad copy failure is non-fatal — user still gets media, they just don't
    // get the pre-written headline/CTA. Continue.
  }

  // Item rows — one per (kind, format, variantIdx) slot.
  interface PendingItem { itemId: string; kind: HiggsfieldOutputKind; format: '1:1'|'4:5'|'9:16'|'16:9'; variantIdx: number; prompt: string; credits: number }
  const pendingItems: PendingItem[] = []
  const itemInserts: Record<string, unknown>[] = []
  if (wantImages) {
    for (const p of claudeBundle.imagePrompts) {
      const credits = creditsPerItem('image', 0)
      itemInserts.push({
        generation_id: generationId,
        user_id: userId,
        kind: 'image',
        format: p.format,
        variant_idx: p.variantIdx,
        prompt_used: p.prompt,
        higgsfield_model: HIGGSFIELD_MODELS.image.slug,
        status: 'queued',
        credits_charged: credits,
      })
    }
  }
  if (wantVideos) {
    for (const p of claudeBundle.videoPrompts) {
      const credits = creditsPerItem('video', parsed.videoDurationSeconds ?? 0)
      itemInserts.push({
        generation_id: generationId,
        user_id: userId,
        kind: 'video',
        format: p.format,
        variant_idx: p.variantIdx,
        prompt_used: p.prompt,
        higgsfield_model: HIGGSFIELD_MODELS.video.slug,
        status: 'queued',
        credits_charged: credits,
      })
    }
  }
  const { data: items, error: itemsError } = await supabaseAdmin.from('qads_items').insert(itemInserts).select('id, kind, format, variant_idx, prompt_used, credits_charged')
  if (itemsError || !items) {
    console.error('[qads/generate] qads_items insert failed:', itemsError?.message)
    return NextResponse.json({ error: 'Failed to persist items', code: 'db_error' }, { status: 500 })
  }
  for (const row of items) {
    pendingItems.push({
      itemId: row.id as string,
      kind: row.kind as HiggsfieldOutputKind,
      format: row.format as '1:1'|'4:5'|'9:16'|'16:9',
      variantIdx: row.variant_idx as number,
      prompt: row.prompt_used as string,
      credits: row.credits_charged as number,
    })
  }

  // ── 5. Reserve credits atomically (single credit_ledger row) ──
  const reserve = await reserveGeneratorCredits({
    userId,
    amount: cost.totalCredits,
    generationId,
  })
  if (!reserve.ok) {
    // Race with a parallel submit that spent the user's balance between our
    // check and this reservation. Mark the generation failed and bail — no
    // Higgsfield calls have been made yet, so no refund needed.
    await supabaseAdmin.from('qads_generations').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', generationId)
    return NextResponse.json({ error: 'insufficient_credits', code: 'insufficient_credits', balance: reserve.balance, needed: reserve.needed }, { status: 402 })
  }

  // ── 6. Submit to Higgsfield with a concurrency cap ──
  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) {
    // Config-time error — refund everything reserved.
    await refundGeneratorCredits({ userId, amount: cost.totalCredits, generationId, reason: 'qads_higgsfield_not_configured' })
    await supabaseAdmin.from('qads_generations').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', generationId)
    return NextResponse.json({ error: 'Media provider not configured', code: 'provider_missing' }, { status: 500 })
  }
  const provider = createHiggsfieldProvider(creds)
  const webhookBase = process.env.NEXT_PUBLIC_APP_URL || ''
  const webhookSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET || ''
  // First uploaded photo is the primary product reference; extra photos are
  // additional context the model can lean on (Marketing Studio Image takes an
  // image_urls array; Seedance the same). Pass all of them per Higgsfield's
  // shape.
  const referenceImageUrl = parsed.photoSignedUrls[0]
  const modelImageUrl = parsed.photoSignedUrls[1] // optional secondary reference

  await runWithConcurrency(pendingItems, HIGGSFIELD_SUBMIT_CONCURRENCY, async item => {
    const webhookUrl = webhookBase && webhookSecret
      ? `${webhookBase}/api/webhooks/higgsfield?item=${item.itemId}&s=${webhookSecret}`
      : undefined
    const input: MediaGenerationInput = {
      kind: item.kind,
      prompt: item.prompt,
      format: item.format,
      referenceImageUrl,
      modelImageUrl,
      webhookUrl,
    }
    try {
      const handle = await provider.submit(input)
      await supabaseAdmin.from('qads_items').update({
        higgsfield_request_id: handle.providerRequestId,
        higgsfield_status_url: handle.statusUrl,
        higgsfield_cancel_url: handle.cancelUrl ?? null,
        status: 'generating',
      }).eq('id', item.itemId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submit_failed'
      console.error(`[qads/generate] Higgsfield submit failed for item ${item.itemId}:`, message)
      await supabaseAdmin.from('qads_items').update({
        status: 'failed',
        error_message: message.slice(0, 500),
        completed_at: new Date().toISOString(),
      }).eq('id', item.itemId)
      // Refund only this item's cost; sibling items keep their reservation.
      await refundGeneratorCredits({
        userId,
        amount: item.credits,
        generationId,
        reason: 'qads_item_submit_failed',
      })
    }
  })

  // Flip generation from queued → generating now that submits have gone out
  // (or failed). The webhook/sweep-stuck cron will move it to completed/
  // partial/failed as items finish.
  await supabaseAdmin.from('qads_generations').update({ status: 'generating' }).eq('id', generationId)

  return NextResponse.json({
    generationId,
    status: 'generating',
    totalCredits: cost.totalCredits,
    itemCount: pendingItems.length,
  })
}

function stripJsonFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift()
      if (next === undefined) return
      await worker(next)
    }
  })
  await Promise.all(runners)
}
