// POST /api/webhooks/higgsfield?item={qads_items.id}&s={per-item token}
// Completion callback for a single Higgsfield generation request configured
// via the hf_webhook query param at submit time (see
// lib/qads/media/providers/higgsfield/client.ts).
//
// Verification: Higgsfield's documented webhook contract provides no HMAC /
// signing scheme, so:
//   1. the URL carries HMAC(HIGGSFIELD_WEBHOOK_SECRET, itemId), compared in
//      constant time (lib/qads/webhook-token.ts) and bound to that one item;
//   2. the payload's request_id must equal the item's stored request id;
//   3. the body is NEVER trusted for the outcome. We re-poll the item's stored
//      Higgsfield status_url with our API key and act only on that answer — so
//      a forged delivery can at most trigger an early status check; it can't
//      fake a failure (refund) or inject an asset URL for us to fetch (SSRF).
//
// Response contract: must reply 2xx within 10 seconds, per Higgsfield docs
// (5xx / network failures are retried for up to two hours; 4xx are treated
// as permanent). Duplicate deliveries can happen — every terminal transition
// is an atomic conditional update and only the winner refunds (see
// lib/qads/items.ts), so a retried delivery racing the sweep cron can't
// double-refund.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseHiggsfieldWebhook } from '@/lib/qads/media/providers/higgsfield/mapper'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { verifyQadsWebhookToken } from '@/lib/qads/webhook-token'
import { applyProviderResult, maybeCompleteGeneration, TERMINAL_ITEM_STATUSES } from '@/lib/qads/items'

export const maxDuration = 30

export async function POST(request: Request) {
  const url = new URL(request.url)
  const itemId = url.searchParams.get('item') ?? ''
  const providedToken = url.searchParams.get('s') ?? ''
  if (!z.string().uuid().safeParse(itemId).success || !verifyQadsWebhookToken(itemId, providedToken)) {
    // 4xx per docs — a bad token is a permanent failure, not a delivery to
    // retry. Same 401 whether the secret is unset or mismatched.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const { data: item } = await supabaseAdmin
    .from('qads_items')
    .select('id, generation_id, user_id, status, credits_charged, higgsfield_request_id, higgsfield_status_url')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) {
    return NextResponse.json({ error: 'Unknown item' }, { status: 404 })
  }

  if (!item.higgsfield_request_id) {
    // The submit call hasn't stored the request id yet (fast job) — ask
    // Higgsfield to retry. Items being re-claimed for regeneration also land
    // here briefly; the retry then no longer matches and is acked below.
    if (item.status === 'queued') return NextResponse.json({ error: 'Not ready' }, { status: 503 })
    return NextResponse.json({ ok: true, ignored: true })
  }
  if (item.higgsfield_request_id !== parsed.providerRequestId) {
    // Late delivery for a previous attempt of a regenerated item — ack so it
    // isn't retried, but don't act on it.
    return NextResponse.json({ ok: true, ignored: true })
  }

  if ((TERMINAL_ITEM_STATUSES as readonly string[]).includes(item.status as string)) {
    // Already terminal — dedup silently.
    return NextResponse.json({ ok: true, deduped: true })
  }

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds || !item.higgsfield_status_url) {
    return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503 })
  }
  const provider = createHiggsfieldProvider(creds)

  // Authoritative state comes from Higgsfield, not from the request body.
  let result
  try {
    result = await provider.getStatus(item.higgsfield_status_url as string)
  } catch (err) {
    console.error(`[webhooks/higgsfield] status poll failed for item ${item.id}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Status poll failed' }, { status: 502 })
  }

  const outcome = await applyProviderResult(
    {
      id: item.id as string,
      generation_id: item.generation_id as string,
      user_id: item.user_id as string,
      credits_charged: item.credits_charged as number,
    },
    result,
  )
  if (outcome === 'pending') {
    // Webhooks fire on terminal states; if the poll isn't terminal yet, let
    // Higgsfield retry later (the sweep cron is the backstop).
    return NextResponse.json({ error: 'Not terminal yet' }, { status: 503 })
  }

  // Roll the parent generation's aggregate status forward if all items reached a terminal state.
  await maybeCompleteGeneration(item.generation_id as string)

  return NextResponse.json({ ok: true })
}
