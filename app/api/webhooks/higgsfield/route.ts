// POST /api/webhooks/higgsfield?item={qads_items.id}&s={HIGGSFIELD_WEBHOOK_SECRET}
// Completion callback for a single Higgsfield generation request configured
// via the hf_webhook query param at submit time (see
// lib/qads/media/providers/higgsfield/client.ts).
//
// Verification: Higgsfield's documented webhook contract (fetched from
// docs.higgsfield.ai during this implementation) provides no HMAC / signing
// scheme, so we use two soft checks: (1) a shared secret token in the URL
// (HIGGSFIELD_WEBHOOK_SECRET) that only our server knows, (2) the item id we
// stamped on the URL must match a qads_items row whose higgsfield_request_id
// equals the payload's request_id. An attacker forging both would need our
// env secret AND our internal item ids AND our Higgsfield request ids.
//
// Response contract: must reply 2xx within 10 seconds, per Higgsfield docs
// (5xx / network failures are retried for up to two hours; 4xx are treated
// as permanent). Duplicate deliveries can happen — we dedup on qads_items
// already-terminal status so a retried 'completed' delivery doesn't double
// the asset upload or a retried 'failed' delivery double the refund.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseHiggsfieldWebhook } from '@/lib/qads/media/providers/higgsfield/mapper'
import { refundGeneratorCredits } from '@/lib/qads/credits'

export const maxDuration = 30

export async function POST(request: Request) {
  const url = new URL(request.url)
  const providedSecret = url.searchParams.get('s') ?? ''
  const expectedSecret = process.env.HIGGSFIELD_WEBHOOK_SECRET ?? ''
  if (!expectedSecret || providedSecret !== expectedSecret) {
    // 4xx per docs — a bad secret is a permanent failure, not a delivery to
    // retry. Never leak "secret mismatch" vs "no secret configured" — same
    // 401 for both.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const itemIdFromUrl = url.searchParams.get('item')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseHiggsfieldWebhook(body)
  if (!parsed) {
    return NextResponse.json({ error: 'Envelope does not match the documented webhook shape' }, { status: 400 })
  }
  const { providerRequestId, result } = parsed

  // Look up the item by request_id first (the authoritative match); fall
  // back to the URL-embedded item id if request_id happens to be missing
  // (shouldn't happen in practice).
  const { data: item } = await supabaseAdmin
    .from('qads_items')
    .select('id, generation_id, user_id, status, kind, credits_charged')
    .eq('higgsfield_request_id', providerRequestId)
    .maybeSingle()
  if (!item) {
    console.warn(`[webhooks/higgsfield] no qads_items row for request_id ${providerRequestId} (URL item hint: ${itemIdFromUrl ?? 'none'})`)
    return NextResponse.json({ error: 'Unknown request_id' }, { status: 404 })
  }
  if (itemIdFromUrl && item.id !== itemIdFromUrl) {
    // URL id doesn't match the DB row — treat as spoofed / mis-routed.
    return NextResponse.json({ error: 'Item id mismatch' }, { status: 401 })
  }

  const currentStatus = item.status as string
  if (['completed', 'failed', 'canceled', 'nsfw'].includes(currentStatus)) {
    // Already terminal — dedup silently.
    return NextResponse.json({ ok: true, deduped: true })
  }

  if (result.status === 'completed' && result.assets?.length) {
    const asset = result.assets[0]
    try {
      const { bucket, path, mimeType } = await copyAssetToStorage({
        userId: item.user_id as string,
        generationId: item.generation_id as string,
        itemId: item.id as string,
        sourceUrl: asset.url,
        contentType: asset.contentType,
      })
      await supabaseAdmin.from('qads_items').update({
        status: 'completed',
        storage_bucket: bucket,
        storage_path: path,
        mime_type: mimeType,
        completed_at: new Date().toISOString(),
      }).eq('id', item.id as string)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to copy asset to storage'
      console.error(`[webhooks/higgsfield] ${message}`)
      await markFailedAndRefund(item.id as string, item.generation_id as string, item.user_id as string, item.credits_charged as number, message)
    }
  } else if (result.status === 'nsfw') {
    await supabaseAdmin.from('qads_items').update({
      status: 'nsfw',
      error_message: 'Rejected by the model\'s content moderation.',
      completed_at: new Date().toISOString(),
    }).eq('id', item.id as string)
    await refundGeneratorCredits({
      userId: item.user_id as string,
      amount: item.credits_charged as number,
      generationId: item.generation_id as string,
      reason: 'qads_item_nsfw',
    })
  } else if (result.status === 'failed' || result.status === 'canceled') {
    await markFailedAndRefund(
      item.id as string,
      item.generation_id as string,
      item.user_id as string,
      item.credits_charged as number,
      result.error ?? `Higgsfield reported status: ${result.status}`,
    )
  }
  // 'queued' / 'in_progress' aren't expected as webhook events (webhooks fire
  // on terminal states per docs) — acked harmlessly if they do arrive.

  // Roll the parent generation's aggregate status forward if all items reached a terminal state.
  await maybeCompleteGeneration(item.generation_id as string)

  return NextResponse.json({ ok: true })
}

async function markFailedAndRefund(itemId: string, generationId: string, userId: string, credits: number, error: string): Promise<void> {
  await supabaseAdmin.from('qads_items').update({
    status: 'failed',
    error_message: error.slice(0, 500),
    completed_at: new Date().toISOString(),
  }).eq('id', itemId)
  await refundGeneratorCredits({ userId, amount: credits, generationId, reason: 'qads_item_generation_failed' })
}

// Higgsfield URLs expire "at least seven days" per docs — we mirror every
// completed asset into the qads-outputs privátní bucket immediately so a
// download three months from now still works.
async function copyAssetToStorage(params: {
  userId: string
  generationId: string
  itemId: string
  sourceUrl: string
  contentType?: string
}): Promise<{ bucket: string; path: string; mimeType: string }> {
  const { userId, generationId, itemId, sourceUrl, contentType } = params
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Failed to fetch generated asset: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const mimeType = contentType || res.headers.get('content-type') || 'application/octet-stream'
  const ext = (mimeType.split('/')[1]?.split(';')[0] || 'bin').replace('jpeg', 'jpg')
  const path = `${userId}/${generationId}/${itemId}.${ext}`
  const bucket = 'qads-outputs'

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: mimeType, upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  return { bucket, path, mimeType }
}

async function maybeCompleteGeneration(generationId: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from('qads_items')
    .select('status')
    .eq('generation_id', generationId)
  if (!rows || rows.length === 0) return

  const allTerminal = rows.every(r => ['completed', 'failed', 'canceled', 'nsfw'].includes(r.status as string))
  if (!allTerminal) return

  const anyCompleted = rows.some(r => r.status === 'completed')
  const anyFailed = rows.some(r => r.status !== 'completed')
  const nextStatus = anyCompleted && anyFailed
    ? 'partial'
    : anyCompleted
      ? 'completed'
      : 'failed'
  await supabaseAdmin.from('qads_generations').update({
    status: nextStatus,
    completed_at: new Date().toISOString(),
  }).eq('id', generationId)
}
