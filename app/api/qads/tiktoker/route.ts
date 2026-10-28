// POST /api/qads/tiktoker — a vertical video in which the caller's AI character talks about the
// product (lib/qads/tiktoker.ts). Same shape as POST /api/qads/generate:
//   1. validate; photo paths must be the caller's own uploads, the character the caller's own
//      finished one — both signed server-side
//   2. charge up front (lib/qads/charge.ts; Agency = fair use)
//   3. one short Claude call (MODELS.intake) that SEES the product photo and writes, per
//      variant, the spoken script + the video prompt + ad copy
//   4. one qads_items row per paid variant (extra output from Claude is dropped), then
//      Higgsfield Wan 3.0 with speech; the webhook / sweep deliver the clips
// Refunds: provider or infrastructure failures refund everything still unspent; unusable Claude
// output refunds the video part and keeps the small script fee (that call was real spend).

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { anthropic, messageText, MODELS } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { computeTiktokerCost, tiktokerVideoCredits, TIKTOKER_DURATIONS, TIKTOKER_MODELS } from '@/lib/qads/pricing'
import { refundGeneratorCredits } from '@/lib/qads/credits'
import { failItemAndRefund } from '@/lib/qads/items'
import { isMissingCommunityColumn } from '@/lib/qads/community'
import { buildQadsWebhookUrl } from '@/lib/qads/webhook-token'
import { isOwnQadsInputPath, signQadsInputPaths } from '@/lib/qads/inputs'
import { chargeQadsGeneration, loadOwnCharacter, signOutput } from '@/lib/qads/charge'
import {
  TIKTOKER_STYLE,
  TIKTOKER_SYSTEM_PROMPT,
  TiktokerScriptSchema,
  buildTiktokerUserMessage,
  encodeTiktokerItem,
  withSpokenLine,
  type TiktokerScript,
} from '@/lib/qads/tiktoker'

export const maxDuration = 120
const CLAUDE_TIMEOUT_MS = 60_000

const BODY = z.object({
  productName: z.string().trim().min(1).max(120),
  productDescription: z.string().trim().max(2000).default(''),
  photoStoragePaths: z.array(z.string().min(1).max(300)).min(1).max(2),
  characterId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  durationSeconds: z.number().int().refine(n => (TIKTOKER_DURATIONS as readonly number[]).includes(n), { message: 'Unsupported length' }),
  variants: z.number().int().min(1).max(2),
  language: z.enum(['cs', 'en', 'sk', 'de']),
  shareCommunity: z.boolean().optional().default(false),
})

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  // ── 1. Validate ──
  let body: z.infer<typeof BODY>
  try {
    body = BODY.parse(await request.json())
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid request body'
    return NextResponse.json({ error: detail, code: 'bad_request' }, { status: 400 })
  }
  if (!body.photoStoragePaths.every(p => isOwnQadsInputPath(userId, p))) {
    return NextResponse.json({ error: 'Invalid photo path', code: 'bad_request' }, { status: 400 })
  }
  if (body.projectId) {
    const { data: project } = await supabaseAdmin.from('projects').select('user_id').eq('id', body.projectId).maybeSingle()
    if (!project || project.user_id !== userId) return NextResponse.json({ error: 'Project not found', code: 'bad_request' }, { status: 400 })
  }
  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) return NextResponse.json({ error: 'Media provider not configured', code: 'provider_missing' }, { status: 500 })

  const character = await loadOwnCharacter(userId, body.characterId)
  if (!character) return NextResponse.json({ error: 'Pick a finished character first.', code: 'bad_request' }, { status: 400 })
  const [photoUrls, characterUrl] = await Promise.all([
    signQadsInputPaths(body.photoStoragePaths),
    signOutput(character.bucket, character.path),
  ])
  if (!photoUrls) return NextResponse.json({ error: 'Uploaded photo not found — please re-upload.', code: 'bad_request' }, { status: 400 })
  if (!characterUrl) return NextResponse.json({ error: 'Could not load the character.', code: 'bad_request' }, { status: 400 })

  // ── 2. Charge ──
  const cost = computeTiktokerCost(body.variants, body.durationSeconds)
  const perVideo = tiktokerVideoCredits(body.durationSeconds)
  const generationId = randomUUID()
  const charge = await chargeQadsGeneration({ userId, generationId, credits: cost.totalCredits, videos: body.variants, images: 0 })
  if (!charge.ok) return charge.response
  const agency = charge.agency

  const row = {
    id: generationId,
    user_id: userId,
    project_id: body.projectId ?? null,
    product_name: body.productName,
    product_description: body.productDescription,
    input_photo_urls: body.photoStoragePaths,
    output_types: ['video'],
    formats: ['9:16'],
    style: TIKTOKER_STYLE,
    variants_per_format: body.variants,
    video_duration_s: body.durationSeconds,
    language: body.language,
    total_credits_reserved: agency ? 0 : cost.totalCredits,
    status: 'queued',
    share_community: body.shareCommunity,
  }
  let { error: genError } = await supabaseAdmin.from('qads_generations').insert(row)
  if (genError && isMissingCommunityColumn(genError)) {
    const withoutShare: Partial<typeof row> = { ...row }
    delete withoutShare.share_community
    ;({ error: genError } = await supabaseAdmin.from('qads_generations').insert(withoutShare))
  }
  if (genError) {
    console.error('[qads/tiktoker] generation insert failed:', genError.message)
    if (!agency) await refundGeneratorCredits({ userId, generationId, reason: 'qads_generation_hard_failure' })
    return NextResponse.json({ error: 'Failed to persist generation', code: 'db_error' }, { status: 500 })
  }
  const failGeneration = async (reason: string, amount?: number) => {
    await supabaseAdmin.from('qads_generations').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', generationId)
    if (!agency && (amount === undefined || amount > 0)) await refundGeneratorCredits({ userId, generationId, reason, amount })
  }

  // ── 3. Script — Claude sees the product photo ──
  let script: TiktokerScript
  try {
    const response = await anthropic.messages.create(
      {
        model: MODELS.intake,
        max_tokens: 4000,
        system: TIKTOKER_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: photoUrls[0] } },
            {
              type: 'text',
              text: buildTiktokerUserMessage({
                productName: body.productName,
                productDescription: body.productDescription,
                characterSummary: character.summary,
                language: body.language,
                seconds: body.durationSeconds,
                variants: body.variants,
              }),
            },
          ],
        }],
      },
      { timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 },
    )
    const text = messageText(response).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      script = TiktokerScriptSchema.parse(JSON.parse(text))
    } catch (err) {
      console.error('[qads/tiktoker] script invalid:', err instanceof Error ? err.message : err)
      await failGeneration('qads_claude_invalid_output', agency ? 0 : cost.videoCredits)
      return NextResponse.json({ error: 'Could not write the script. Please try again.', code: 'claude_failed' }, { status: 502 })
    }
  } catch (err) {
    console.error('[qads/tiktoker] Claude call failed:', err instanceof Error ? err.message : err)
    await failGeneration('qads_claude_failed')
    return NextResponse.json({ error: 'Could not write the script. Please try again.', code: 'claude_failed' }, { status: 502 })
  }

  // ── 4. Exactly one item per paid variant ──
  const variants = Array.from({ length: body.variants }, (_, v) => script.variants.find(x => x.variantIdx === v))
  if (variants.some(v => !v)) {
    await failGeneration('qads_claude_invalid_output', agency ? 0 : cost.videoCredits)
    return NextResponse.json({ error: 'The script was incomplete. Please try again.', code: 'claude_incomplete' }, { status: 502 })
  }
  const chosen = variants as TiktokerScript['variants']

  const { error: copyError } = await supabaseAdmin.from('qads_ad_copy').insert(chosen.map(v => ({
    generation_id: generationId,
    user_id: userId,
    format: '9:16',
    variant_idx: v.variantIdx,
    language: body.language,
    hook: v.hook,
    primary_text: v.primaryText,
    headline: v.headline,
    cta: v.cta,
    video_script: v.script,
    subtitles: null,
  })))
  if (copyError) console.error('[qads/tiktoker] ad copy insert failed:', copyError.message)

  const charged = agency ? 0 : perVideo
  const { data: items, error: itemsError } = await supabaseAdmin.from('qads_items').insert(chosen.map(v => ({
    generation_id: generationId,
    user_id: userId,
    kind: 'video',
    format: '9:16',
    variant_idx: v.variantIdx,
    prompt_used: encodeTiktokerItem(withSpokenLine(v.prompt, v.script, body.language), body.characterId),
    higgsfield_model: TIKTOKER_MODELS.video.slug,
    status: 'queued',
    credits_charged: charged,
  }))).select('id, variant_idx')
  if (itemsError || !items) {
    console.error('[qads/tiktoker] items insert failed:', itemsError?.message)
    await failGeneration('qads_generation_hard_failure')
    return NextResponse.json({ error: 'Failed to persist items', code: 'db_error' }, { status: 500 })
  }

  // ── 5. Submit ──
  const provider = createHiggsfieldProvider(creds)
  await Promise.all(items.map(async it => {
    const v = chosen.find(x => x.variantIdx === it.variant_idx)!
    const itemRef = { id: it.id as string, generation_id: generationId, user_id: userId, credits_charged: charged }
    try {
      const handle = await provider.submit({
        kind: 'video',
        mode: 'tiktoker',
        prompt: withSpokenLine(v.prompt, v.script, body.language),
        format: '9:16',
        characterImageUrl: characterUrl,
        referenceImageUrl: photoUrls[0],
        modelImageUrl: photoUrls[1],
        durationSeconds: body.durationSeconds,
        webhookUrl: buildQadsWebhookUrl(it.id as string),
      })
      await supabaseAdmin.from('qads_items').update({
        higgsfield_request_id: handle.providerRequestId,
        higgsfield_status_url: handle.statusUrl,
        higgsfield_cancel_url: handle.cancelUrl ?? null,
        status: 'generating',
      }).eq('id', it.id).eq('status', 'queued')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submit_failed'
      console.error(`[qads/tiktoker] Higgsfield submit failed for item ${it.id}:`, message)
      await failItemAndRefund(itemRef, { errorMessage: message, refundReason: 'qads_item_submit_failed' })
    }
  }))
  await supabaseAdmin.from('qads_generations').update({ status: 'generating' }).eq('id', generationId).eq('status', 'queued')

  return NextResponse.json({ generationId, status: 'generating', totalCredits: agency ? 0 : cost.totalCredits, itemCount: items.length })
}
