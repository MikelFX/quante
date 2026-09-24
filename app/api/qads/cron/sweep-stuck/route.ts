// GET /api/qads/cron/sweep-stuck — Vercel cron backup path for Higgsfield
// webhook drops. Every qads_items row that's been in queued/generating for
// more than STUCK_AFTER_MINUTES with a stored higgsfield_status_url gets
// re-polled via Higgsfield's status endpoint; if we get a terminal state,
// we apply the same completion / refund logic the webhook route does
// (lib/qads/items.ts — atomic transitions, refund only by the winner).
//
// Also reconciles orphaned generations: credits are debited before Claude /
// Higgsfield run, so a generate request killed mid-flight leaves a 'queued'
// generation (and possibly never-submitted items). Those are failed and
// refunded here exactly once.
//
// Never fires more than one poll per item per cron tick — the daily
// (Hobby-plan-friendly) schedule handles this at the tick boundary; if
// upgraded to Pro / more frequent, add a lastPolledAt column and gate on it.
//
// Auth: fails closed via isAuthorizedCron (Authorization: Bearer CRON_SECRET;
// rejected when CRON_SECRET is unset).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { applyProviderResult, failItemAndRefund, maybeCompleteGeneration } from '@/lib/qads/items'
import { refundGeneratorCredits, sumGenerationRefunds } from '@/lib/qads/credits'

export const maxDuration = 300

const STUCK_AFTER_MINUTES = 10
// Well past the generate route's maxDuration, so a live request is never touched.
const ORPHAN_AFTER_MINUTES = 15
const MAX_ITEMS_PER_RUN = 200
const MAX_ORPHANS_PER_RUN = 100

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = { polled: 0, completed: 0, failed: 0, still_generating: 0, errors: 0, orphans: 0 }

  // ── Orphaned generations (function died after the debit) ──
  const orphanCutoff = new Date(Date.now() - ORPHAN_AFTER_MINUTES * 60_000).toISOString()
  const { data: orphans } = await supabaseAdmin
    .from('qads_generations')
    .select('id, user_id, total_credits_reserved')
    .eq('status', 'queued')
    .lt('created_at', orphanCutoff)
    .limit(MAX_ORPHANS_PER_RUN)
  for (const gen of orphans ?? []) {
    try {
      await reconcileOrphan(gen.id as string, gen.user_id as string, Number(gen.total_credits_reserved) || 0)
      summary.orphans++
    } catch (err) {
      summary.errors++
      console.error(`[qads/sweep-stuck] orphan ${gen.id} reconcile error:`, err instanceof Error ? err.message : err)
    }
  }

  // ── Stuck in-flight items ──
  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) return NextResponse.json({ error: 'Higgsfield not configured', summary }, { status: 500 })
  const provider = createHiggsfieldProvider(creds)

  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString()
  const { data: stuck } = await supabaseAdmin
    .from('qads_items')
    .select('id, generation_id, user_id, higgsfield_status_url, credits_charged, status')
    .in('status', ['queued', 'generating'])
    .not('higgsfield_status_url', 'is', null)
    .lt('created_at', cutoff)
    .limit(MAX_ITEMS_PER_RUN)

  for (const item of stuck ?? []) {
    summary.polled++
    try {
      const status = await provider.getStatus(item.higgsfield_status_url as string)
      const outcome = await applyProviderResult(
        {
          id: item.id as string,
          generation_id: item.generation_id as string,
          user_id: item.user_id as string,
          credits_charged: item.credits_charged as number,
        },
        status,
      )
      if (outcome === 'completed') summary.completed++
      else if (outcome === 'failed') summary.failed++
      else if (outcome === 'pending') summary.still_generating++
      await maybeCompleteGeneration(item.generation_id as string)
    } catch (err) {
      summary.errors++
      console.error(`[qads/sweep-stuck] item ${item.id} poll error:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, summary })
}

async function reconcileOrphan(generationId: string, userId: string, totalReserved: number): Promise<void> {
  // Items created but never submitted: fail + refund each (atomic, winner-only).
  const { data: items } = await supabaseAdmin
    .from('qads_items')
    .select('id, generation_id, user_id, credits_charged, status, higgsfield_request_id')
    .eq('generation_id', generationId)
  for (const it of items ?? []) {
    if (it.status === 'queued' && !it.higgsfield_request_id) {
      await failItemAndRefund(
        { id: it.id as string, generation_id: generationId, user_id: userId, credits_charged: it.credits_charged as number },
        { errorMessage: 'Generation was interrupted before this item was submitted.', refundReason: 'qads_item_submit_failed' },
      )
    }
  }

  if (!items || items.length === 0) {
    // Died before items existed (during Claude): claim the generation, then
    // refund whatever of the reservation hasn't been refunded yet.
    const { data: won } = await supabaseAdmin
      .from('qads_generations')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', generationId)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle()
    if (!won) return
    const remaining = totalReserved - (await sumGenerationRefunds(userId, generationId))
    if (remaining > 0) {
      await refundGeneratorCredits({ userId, amount: remaining, generationId, reason: 'qads_generation_orphaned' })
    }
    return
  }

  // Items exist: submitted ones are handled by the normal item sweep / webhook.
  await supabaseAdmin.from('qads_generations').update({ status: 'generating' }).eq('id', generationId).eq('status', 'queued')
  await maybeCompleteGeneration(generationId)
}
