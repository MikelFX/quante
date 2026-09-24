// POST /api/qads/generations/[id]/regenerate-item — re-run one item using
// the same prompt Claude wrote originally. Costs the same as a fresh item
// of that kind (see lib/qads/pricing.ts creditsPerItem). Debits the user
// atomically and fires a new Higgsfield submit; the webhook path is the
// same as first-time generation.
//
// This is the "Vygenerovat znovu" affordance on a single failed or unwanted
// variant tile — cheaper for the user than resubmitting the whole
// generation.
//
// Concurrency: the item is claimed (terminal → queued) with a conditional
// update BEFORE the debit, so parallel clicks produce exactly one paid
// re-render; the rest get 409 and are never charged.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import {
  reserveGeneratorCredits,
  refundGeneratorCredits,
  countRecentReserves,
  QADS_RESERVES_PER_HOUR,
  QADS_BILLING_HOLD_MESSAGE,
} from '@/lib/qads/credits'
import { failItemAndRefund, TERMINAL_ITEM_STATUSES } from '@/lib/qads/items'
import { buildQadsWebhookUrl } from '@/lib/qads/webhook-token'
import { isOwnQadsInputPath, signQadsInputPaths } from '@/lib/qads/inputs'
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
  if (!z.string().uuid().safeParse(generationId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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
  // A generation still being created (or orphaned and awaiting the sweep) is
  // off-limits — its items are reconciled by the sweep, not re-rendered.
  if (generation.status === 'queued') {
    return NextResponse.json({ error: 'Generation is still being set up' }, { status: 409 })
  }
  if (!(TERMINAL_ITEM_STATUSES as readonly string[]).includes(item.status as string)) {
    return NextResponse.json({ error: 'Item is already generating' }, { status: 409 })
  }

  // Cost matches the original item's kind + the generation's video duration.
  const kind = item.kind as 'image' | 'video'
  const durationSeconds = kind === 'video' ? Number(generation.video_duration_s ?? 0) : 0
  const cost = creditsPerItem(kind, durationSeconds)

  // Everything that can fail for config/input reasons is checked before we
  // claim or charge.
  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) return NextResponse.json({ error: 'Provider not configured' }, { status: 500 })
  const provider = createHiggsfieldProvider(creds)

  // Defence in depth: older rows could hold foreign paths written before the
  // generate route validated them — never sign those with the service role.
  const paths = ((generation.input_photo_urls as string[] | null) ?? []).slice(0, 2)
  if (paths.length === 0) return NextResponse.json({ error: 'Original photo unavailable' }, { status: 500 })
  if (!paths.every(p => isOwnQadsInputPath(userId, p))) {
    return NextResponse.json({ error: 'Original photo unavailable' }, { status: 400 })
  }
  const signed = await signQadsInputPaths(paths)
  if (!signed) return NextResponse.json({ error: 'Failed to load input photo' }, { status: 500 })

  // ── Claim the item atomically (terminal → queued). Clearing the request id
  // detaches any late webhook for the previous attempt from this item.
  const previous = {
    status: item.status as string,
    higgsfield_request_id: (item.higgsfield_request_id as string | null) ?? null,
    higgsfield_status_url: (item.higgsfield_status_url as string | null) ?? null,
    higgsfield_cancel_url: (item.higgsfield_cancel_url as string | null) ?? null,
  }
  const { data: claimed } = await supabaseAdmin
    .from('qads_items')
    .update({ status: 'queued', higgsfield_request_id: null, higgsfield_status_url: null, higgsfield_cancel_url: null })
    .eq('id', itemId)
    .eq('user_id', userId)
    .eq('status', previous.status)
    .select('id')
    .maybeSingle()
  if (!claimed) return NextResponse.json({ error: 'Item is already generating' }, { status: 409 })

  const releaseClaim = async () => {
    await supabaseAdmin.from('qads_items')
      .update(previous)
      .eq('id', itemId)
      .eq('status', 'queued')
      .is('higgsfield_request_id', null)
  }

  // ── Atomic debit ──
  const reserve = await reserveGeneratorCredits({ userId, amount: cost, generationId })
  if (!reserve.ok) {
    await releaseClaim()
    if (reserve.error === 'billing_hold') {
      return NextResponse.json(
        { error: 'billing_hold', code: 'billing_hold', message: QADS_BILLING_HOLD_MESSAGE },
        { status: 402 },
      )
    }
    return NextResponse.json(
      { error: reserve.error, balance: reserve.balance, needed: reserve.needed },
      { status: reserve.error === 'insufficient_credits' ? 402 : 500 },
    )
  }
  if ((await countRecentReserves(userId)) > QADS_RESERVES_PER_HOUR) {
    await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_rate_limited' })
    await releaseClaim()
    return NextResponse.json({ error: `Rate limit reached — max ${QADS_RESERVES_PER_HOUR} Qads renders per hour.` }, { status: 429 })
  }

  const itemRef = { id: itemId, generation_id: generationId, user_id: userId, credits_charged: cost }
  const submitInput: MediaGenerationInput = {
    kind,
    prompt: item.prompt_used as string,
    format: item.format as '1:1'|'4:5'|'9:16'|'16:9',
    referenceImageUrl: signed[0],
    modelImageUrl: signed[1],
    durationSeconds: kind === 'video' ? durationSeconds : undefined,
    webhookUrl: buildQadsWebhookUrl(itemId),
  }
  try {
    const handle = await provider.submit(submitInput)
    const { data: updated } = await supabaseAdmin.from('qads_items').update({
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
    }).eq('id', itemId).eq('status', 'queued').select('id').maybeSingle()
    if (!updated) {
      // Lost our claim (should not happen) — don't leave a paid, orphaned job.
      console.error(`[qads/regenerate-item] claim lost for item ${itemId}; refunding`)
      if (handle.cancelUrl) await provider.cancel(handle.cancelUrl)
      await refundGeneratorCredits({ userId, amount: cost, generationId, reason: 'qads_item_submit_failed' })
      return NextResponse.json({ error: 'Item changed while submitting' }, { status: 409 })
    }
    // Provider request ids are internal (they key the webhook) — not returned.
    return NextResponse.json({ ok: true, itemId, higgsfieldRequestId: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'submit_failed'
    console.error(`[qads/regenerate-item] Higgsfield submit failed for item ${itemId}:`, message)
    await failItemAndRefund(itemRef, { errorMessage: message, refundReason: 'qads_item_submit_failed' })
    return NextResponse.json({ error: 'Submit failed' }, { status: 502 })
  }
}
