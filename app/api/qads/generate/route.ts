// POST /api/qads/generate — the main entry point for the /qads generator.
// Flow (all inline, no queue):
//   1. Auth + zod-validate the form payload; photo paths must be the caller's
//      own uploads and are signed server-side (client signed URLs are ignored)
//   2. Compute total cost from lib/qads/pricing.ts and DEBIT it atomically
//      (lib/credits.ts) BEFORE any paid work — Claude or Higgsfield. The debit
//      is the balance check; a parallel request can't slip past it.
//   3. Rate-limit (counted after our own debit so it is race-safe)
//   4. Insert the qads_generations row, then one Claude call for every image /
//      video prompt + all ad copy (deterministic JSON, validated with zod)
//   5. Build exactly ONE item per paid (kind, format, variant) slot — extra or
//      duplicate prompts from Claude are dropped, never rendered
//   6. Fire Higgsfield submits per item with a small parallelism cap; each
//      submit failure atomically fails that item and refunds only its cost.
//   7. Return {generationId, status} immediately. The client polls
//      GET /api/qads/generations/:id for progress; the webhook fills in the
//      Higgsfield-generated assets as they arrive.
//
// Refund policy: provider / infrastructure failures refund everything still
// unspent. When Claude answers but its output is unusable (bad JSON, missing
// slots) the media part is refunded and the strategy fee is kept — that Claude
// call was real spend, and refunding it would make the endpoint a free,
// scriptable top-tier Claude proxy.

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { anthropic, MODELS } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { HIGGSFIELD_MODELS, computeGeneratorCost, creditsPerItem, type HiggsfieldOutputKind } from '@/lib/qads/pricing'
import {
  reserveGeneratorCredits,
  refundGeneratorCredits,
  countRecentReserves,
  QADS_RESERVES_PER_HOUR,
  QADS_GENERATIONS_PER_HOUR,
  QADS_BILLING_HOLD_MESSAGE,
} from '@/lib/qads/credits'
import { failItemAndRefund } from '@/lib/qads/items'
import { buildQadsWebhookUrl } from '@/lib/qads/webhook-token'
import { isOwnQadsInputPath, signQadsInputPaths } from '@/lib/qads/inputs'
import { getQadsStyle, isValidStyleId, type QadsStyleId } from '@/lib/qads/styles'
import {
  GENERATOR_SYSTEM_PROMPT,
  GeneratorPromptOutputSchema,
  buildGeneratorUserMessage,
  type GeneratorPromptOutput,
} from '@/lib/qads/claude/generator-prompts'
import type { MediaGenerationInput } from '@/lib/qads/media/types'

// Claude call is capped at CLAUDE_TIMEOUT_MS so we always reach the refund
// path before the platform kills the function (credits are debited up front).
export const maxDuration = 120
const CLAUDE_TIMEOUT_MS = 80_000

type Format = '1:1' | '4:5' | '9:16' | '16:9'

const REQUEST_SCHEMA = z.object({
  productName: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().max(2000).default(''),
  photoStoragePaths: z.array(z.string().min(1).max(300)).min(1).max(4),
  // Accepted for backward compatibility with older clients but IGNORED — the
  // server signs photoStoragePaths itself, so a client can't point Higgsfield
  // (or Claude) at arbitrary URLs.
  photoSignedUrls: z.array(z.string()).max(4).optional(),
  projectId: z.string().uuid().nullable().optional(),
  outputTypes: z.array(z.enum(['image', 'video'])).min(1).max(2),
  formats: z.array(z.enum(['1:1', '4:5', '9:16', '16:9'])).min(1).max(4),
  style: z.string().refine(isValidStyleId, { message: 'Unknown style' }),
  variantsPerFormat: z.number().int().min(1).max(4),
  // Same bounds as the /qads form's stepper; the full duration is rendered
  // (see buildSeedanceVideoRequest) and charged per second.
  videoDurationSeconds: z.number().int().min(4).max(10).nullable().optional(),
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
  // Only the caller's own uploads (as produced by /api/qads/upload) — the
  // service role would otherwise sign any tenant's private photo.
  if (!parsed.photoStoragePaths.every(p => isOwnQadsInputPath(userId, p))) {
    return NextResponse.json({ error: 'Invalid photo path', code: 'bad_request' }, { status: 400 })
  }
  const formats = [...new Set(parsed.formats)] as Format[]
  const outputTypes = [...new Set(parsed.outputTypes)] as HiggsfieldOutputKind[]
  const wantImages = outputTypes.includes('image')
  const wantVideos = outputTypes.includes('video')
  const videoDurationSeconds = wantVideos ? (parsed.videoDurationSeconds ?? null) : null
  if (wantVideos && !videoDurationSeconds) {
    return NextResponse.json({ error: 'videoDurationSeconds is required when video output is requested', code: 'bad_request' }, { status: 400 })
  }
  if (parsed.projectId) {
    const { data: project } = await supabaseAdmin.from('projects').select('user_id').eq('id', parsed.projectId).maybeSingle()
    if (!project || project.user_id !== userId) {
      return NextResponse.json({ error: 'Project not found', code: 'bad_request' }, { status: 400 })
    }
  }

  // Config checks before charging anything.
  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) {
    return NextResponse.json({ error: 'Media provider not configured', code: 'provider_missing' }, { status: 500 })
  }

  // Sign the (validated) input photos server-side; fails cleanly if any
  // object doesn't exist. Free — nothing charged yet.
  const signedUrls = await signQadsInputPaths(parsed.photoStoragePaths)
  if (!signedUrls) {
    return NextResponse.json({ error: 'Uploaded photo not found — please re-upload.', code: 'bad_request' }, { status: 400 })
  }

  // ── 2. Cost + atomic debit (before any paid work) ──
  const cost = computeGeneratorCost({
    outputTypes,
    formats,
    variantsPerFormat: parsed.variantsPerFormat,
    videoDurationSeconds: videoDurationSeconds ?? 0,
  })
  const generationId = randomUUID()
  const reserve = await reserveGeneratorCredits({ userId, amount: cost.totalCredits, generationId })
  if (!reserve.ok) {
    if (reserve.error === 'insufficient_credits') {
      return NextResponse.json(
        { error: 'insufficient_credits', code: 'insufficient_credits', balance: reserve.balance, needed: reserve.needed },
        { status: 402 },
      )
    }
    if (reserve.error === 'billing_hold') {
      return NextResponse.json({ error: QADS_BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Failed to reserve credits', code: 'db_error' }, { status: 500 })
  }

  // ── 3. Rate limit (counts include our own debit → race-safe) ──
  const recentReserves = await countRecentReserves(userId)
  const since = new Date(Date.now() - 3_600_000).toISOString()
  const { count: recentGenerations } = await supabaseAdmin
    .from('qads_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if (recentReserves > QADS_RESERVES_PER_HOUR || (recentGenerations ?? 0) >= QADS_GENERATIONS_PER_HOUR) {
    await refundGeneratorCredits({ userId, generationId, reason: 'qads_rate_limited' })
    return NextResponse.json(
      { error: `Rate limit reached — max ${QADS_GENERATIONS_PER_HOUR} generations per hour.`, code: 'rate_limited' },
      { status: 429 },
    )
  }

  // ── 4a. Persist the generation up front so every debit has a row the
  // sweep cron can reconcile if this function dies mid-flight.
  const { error: genError } = await supabaseAdmin.from('qads_generations').insert({
    id: generationId,
    user_id: userId,
    project_id: parsed.projectId ?? null,
    product_name: parsed.productName,
    product_description: parsed.productDescription,
    input_photo_urls: parsed.photoStoragePaths, // storage paths, not signed URLs
    output_types: outputTypes,
    formats,
    style: parsed.style,
    variants_per_format: parsed.variantsPerFormat,
    video_duration_s: videoDurationSeconds,
    language: parsed.language,
    total_credits_reserved: cost.totalCredits,
    status: 'queued',
  })
  if (genError) {
    console.error('[qads/generate] qads_generations insert failed:', genError.message)
    await refundGeneratorCredits({ userId, generationId, reason: 'qads_generation_hard_failure' })
    return NextResponse.json({ error: 'Failed to persist generation', code: 'db_error' }, { status: 500 })
  }

  const failGeneration = async (refundReason: string, amount?: number) => {
    await supabaseAdmin.from('qads_generations')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', generationId)
    if (amount === undefined || amount > 0) {
      await refundGeneratorCredits({ userId, generationId, reason: refundReason, amount })
    }
  }
  const mediaCredits = cost.totalCredits - cost.strategyCredits

  // ── 4b. Claude — one bulk call for every prompt + all ad copy ──
  const style = getQadsStyle(parsed.style as QadsStyleId)
  let responseText: string
  try {
    const userMessage = buildGeneratorUserMessage({
      productName: parsed.productName,
      productDescription: parsed.productDescription,
      productPhotoUrls: signedUrls,
      style,
      formats,
      variantsPerFormat: parsed.variantsPerFormat,
      wantImages,
      wantVideos,
      videoDurationSeconds: videoDurationSeconds ?? 0,
      language: parsed.language,
    })
    const response = await anthropic.messages.create(
      {
        model: MODELS.generation,
        max_tokens: 8000,
        system: GENERATOR_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      },
      { timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 },
    )
    const textBlock = response.content.find(b => b.type === 'text')
    responseText = textBlock && textBlock.type === 'text' ? textBlock.text : ''
  } catch (err) {
    // Provider error (5xx / overloaded / timeout) — not the user's fault.
    console.error('[qads/generate] Claude call failed:', err instanceof Error ? err.message : err)
    await failGeneration('qads_claude_failed')
    return NextResponse.json(
      { error: 'Failed to generate prompts + ad copy. Please try again.', code: 'claude_failed' },
      { status: 502 },
    )
  }

  let claudeBundle: GeneratorPromptOutput
  try {
    if (!responseText) throw new Error('Claude returned no text content')
    claudeBundle = GeneratorPromptOutputSchema.parse(JSON.parse(stripJsonFences(responseText)))
  } catch (err) {
    console.error('[qads/generate] Claude bundle invalid:', err instanceof Error ? err.message : err)
    await failGeneration('qads_claude_invalid_output', mediaCredits)
    return NextResponse.json(
      { error: 'Failed to generate prompts + ad copy. Please try again.', code: 'claude_failed' },
      { status: 502 },
    )
  }

  // ── 5. Exactly one prompt / copy entry per paid slot ──
  // Iterate the slots WE priced and take the first matching entry for each;
  // extra or duplicate entries in Claude's output are ignored, so the number
  // of Higgsfield jobs can never exceed what the user paid for.
  const firstBySlot = <T extends { format: string; variantIdx: number }>(list: T[]) => {
    const map = new Map<string, T>()
    for (const entry of list) {
      const key = `${entry.format}:${entry.variantIdx}`
      if (!map.has(key)) map.set(key, entry)
    }
    return map
  }
  const imageBySlot = firstBySlot(claudeBundle.imagePrompts)
  const videoBySlot = firstBySlot(claudeBundle.videoPrompts)
  const copyBySlot = firstBySlot(claudeBundle.adCopy)

  interface SlotItem { kind: HiggsfieldOutputKind; format: Format; variantIdx: number; prompt: string; credits: number }
  const slotItems: SlotItem[] = []
  const copyEntries: GeneratorPromptOutput['adCopy'] = []
  let missingSlot = false
  for (const format of formats) {
    for (let v = 0; v < parsed.variantsPerFormat; v++) {
      const key = `${format}:${v}`
      const copy = copyBySlot.get(key)
      if (!copy) { missingSlot = true; continue }
      copyEntries.push(copy)
      if (wantImages) {
        const p = imageBySlot.get(key)
        if (!p) { missingSlot = true; continue }
        slotItems.push({ kind: 'image', format, variantIdx: v, prompt: p.prompt, credits: creditsPerItem('image', 0) })
      }
      if (wantVideos) {
        const p = videoBySlot.get(key)
        if (!p) { missingSlot = true; continue }
        slotItems.push({ kind: 'video', format, variantIdx: v, prompt: p.prompt, credits: creditsPerItem('video', videoDurationSeconds ?? 0) })
      }
    }
  }
  if (missingSlot) {
    await failGeneration('qads_claude_invalid_output', mediaCredits)
    return NextResponse.json(
      { error: 'Prompt bundle was missing slots. Please try again.', code: 'claude_incomplete' },
      { status: 502 },
    )
  }
  // Invariant: what we reserved == Σ per-item charges + strategy fee, so
  // per-item refunds can never exceed the reservation.
  const itemsTotal = slotItems.reduce((acc, it) => acc + it.credits, 0)
  if (itemsTotal + cost.strategyCredits !== cost.totalCredits) {
    console.error(`[qads/generate] cost mismatch: items ${itemsTotal} + strategy ${cost.strategyCredits} != reserved ${cost.totalCredits}`)
    await failGeneration('qads_generation_hard_failure')
    return NextResponse.json({ error: 'Pricing error', code: 'db_error' }, { status: 500 })
  }

  // ── 6. Persist ad copy + items ──
  const copyRows = copyEntries.map(c => ({
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

  const itemInserts = slotItems.map(it => ({
    generation_id: generationId,
    user_id: userId,
    kind: it.kind,
    format: it.format,
    variant_idx: it.variantIdx,
    prompt_used: it.prompt,
    higgsfield_model: it.kind === 'image' ? HIGGSFIELD_MODELS.image.slug : HIGGSFIELD_MODELS.video.slug,
    status: 'queued',
    credits_charged: it.credits,
  }))
  const { data: items, error: itemsError } = await supabaseAdmin
    .from('qads_items')
    .insert(itemInserts)
    .select('id, kind, format, variant_idx, prompt_used, credits_charged')
  if (itemsError || !items) {
    console.error('[qads/generate] qads_items insert failed:', itemsError?.message)
    await failGeneration('qads_generation_hard_failure')
    return NextResponse.json({ error: 'Failed to persist items', code: 'db_error' }, { status: 500 })
  }

  interface PendingItem { itemId: string; kind: HiggsfieldOutputKind; format: Format; prompt: string; credits: number }
  const pendingItems: PendingItem[] = items.map(row => ({
    itemId: row.id as string,
    kind: row.kind as HiggsfieldOutputKind,
    format: row.format as Format,
    prompt: row.prompt_used as string,
    credits: row.credits_charged as number,
  }))

  // ── 7. Submit to Higgsfield with a concurrency cap ──
  const provider = createHiggsfieldProvider(creds)
  // First uploaded photo is the primary product reference; the second (if
  // any) is an optional secondary reference.
  const referenceImageUrl = signedUrls[0]
  const modelImageUrl = signedUrls[1]

  await runWithConcurrency(pendingItems, HIGGSFIELD_SUBMIT_CONCURRENCY, async item => {
    const input: MediaGenerationInput = {
      kind: item.kind,
      prompt: item.prompt,
      format: item.format,
      referenceImageUrl,
      modelImageUrl,
      durationSeconds: item.kind === 'video' ? (videoDurationSeconds ?? undefined) : undefined,
      webhookUrl: buildQadsWebhookUrl(item.itemId),
    }
    const itemRef = { id: item.itemId, generation_id: generationId, user_id: userId, credits_charged: item.credits }
    try {
      const handle = await provider.submit(input)
      await supabaseAdmin.from('qads_items').update({
        higgsfield_request_id: handle.providerRequestId,
        higgsfield_status_url: handle.statusUrl,
        higgsfield_cancel_url: handle.cancelUrl ?? null,
        status: 'generating',
      }).eq('id', item.itemId).eq('status', 'queued')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submit_failed'
      console.error(`[qads/generate] Higgsfield submit failed for item ${item.itemId}:`, message)
      // Refund only this item's cost; sibling items keep their reservation.
      await failItemAndRefund(itemRef, { errorMessage: message, refundReason: 'qads_item_submit_failed' })
    }
  })

  // Flip generation from queued → generating now that submits have gone out
  // (or failed). The webhook/sweep-stuck cron will move it to completed/
  // partial/failed as items finish.
  await supabaseAdmin.from('qads_generations').update({ status: 'generating' }).eq('id', generationId).eq('status', 'queued')

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
