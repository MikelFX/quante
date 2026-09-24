// Shared qads_items state transitions. Server-only. Used by the generate and
// regenerate-item routes, the Higgsfield webhook and the sweep-stuck cron.
//
// Every terminal transition is claimed atomically:
//   update ... where id = $id and status in ('queued','generating') returning id
// and a refund is issued ONLY by the caller that actually flipped the row. Two
// webhook deliveries, a webhook racing the sweep, or parallel sweeps can
// therefore never refund the same paid attempt twice (and refundDebit caps the
// total at what the generation reserved anyway).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { refundGeneratorCredits } from './credits'
import { copyAssetToStorage } from './assets'
import type { MediaGenerationResult } from './media/types'

export const ACTIVE_ITEM_STATUSES = ['queued', 'generating'] as const
export const TERMINAL_ITEM_STATUSES = ['completed', 'failed', 'canceled', 'nsfw'] as const

export interface QadsItemRef {
  id: string
  generation_id: string
  user_id: string
  credits_charged: number
}

// Atomically move an in-flight item to a failed terminal state and refund its
// credits if (and only if) this call won the transition. Returns whether it won.
export async function failItemAndRefund(
  item: QadsItemRef,
  opts: { status?: 'failed' | 'nsfw'; errorMessage: string; refundReason: string },
): Promise<boolean> {
  const { data: won, error } = await supabaseAdmin
    .from('qads_items')
    .update({
      status: opts.status ?? 'failed',
      error_message: opts.errorMessage.slice(0, 500),
      completed_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .in('status', [...ACTIVE_ITEM_STATUSES])
    .select('id')
    .maybeSingle()
  if (error) {
    console.error(`[qads/items] fail transition for ${item.id} errored:`, error.message)
    return false
  }
  if (!won) return false
  const amount = Math.trunc(Number(item.credits_charged) || 0)
  if (amount > 0) {
    await refundGeneratorCredits({
      userId: item.user_id,
      amount,
      generationId: item.generation_id,
      reason: opts.refundReason,
    })
  }
  return true
}

export type ApplyOutcome = 'completed' | 'failed' | 'pending' | 'already_terminal'

// Apply a provider status (from an authenticated Higgsfield poll — never from a
// webhook body) to one item.
export async function applyProviderResult(item: QadsItemRef, result: MediaGenerationResult): Promise<ApplyOutcome> {
  if (result.status === 'completed' && result.assets?.length) {
    let stored: { bucket: string; path: string; mimeType: string }
    try {
      stored = await copyAssetToStorage({
        userId: item.user_id,
        generationId: item.generation_id,
        itemId: item.id,
        sourceUrl: result.assets[0].url,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to copy asset to storage'
      console.error(`[qads/items] asset copy failed for item ${item.id}: ${message}`)
      const won = await failItemAndRefund(item, { errorMessage: message, refundReason: 'qads_item_copy_failed' })
      return won ? 'failed' : 'already_terminal'
    }
    const { data: won } = await supabaseAdmin
      .from('qads_items')
      .update({
        status: 'completed',
        storage_bucket: stored.bucket,
        storage_path: stored.path,
        mime_type: stored.mimeType,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .in('status', [...ACTIVE_ITEM_STATUSES])
      .select('id')
      .maybeSingle()
    return won ? 'completed' : 'already_terminal'
  }

  if (result.status === 'completed') {
    // Completed without any asset — nothing to deliver, treat as a failure.
    const won = await failItemAndRefund(item, {
      errorMessage: 'Provider reported completion without an asset.',
      refundReason: 'qads_item_generation_failed',
    })
    return won ? 'failed' : 'already_terminal'
  }

  if (result.status === 'nsfw') {
    const won = await failItemAndRefund(item, {
      status: 'nsfw',
      errorMessage: 'Rejected by the model\'s content moderation.',
      refundReason: 'qads_item_nsfw',
    })
    return won ? 'failed' : 'already_terminal'
  }

  if (result.status === 'failed' || result.status === 'canceled') {
    const won = await failItemAndRefund(item, {
      errorMessage: result.error ?? `Higgsfield reported status: ${result.status}`,
      refundReason: 'qads_item_generation_failed',
    })
    return won ? 'failed' : 'already_terminal'
  }

  return 'pending'
}

// Roll the parent generation's aggregate status forward once every item has
// reached a terminal state.
export async function maybeCompleteGeneration(generationId: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from('qads_items')
    .select('status')
    .eq('generation_id', generationId)
  if (!rows || rows.length === 0) return

  const allTerminal = rows.every(r => (TERMINAL_ITEM_STATUSES as readonly string[]).includes(r.status as string))
  if (!allTerminal) return

  const anyCompleted = rows.some(r => r.status === 'completed')
  const anyFailed = rows.some(r => r.status !== 'completed')
  const nextStatus = anyCompleted && anyFailed ? 'partial' : anyCompleted ? 'completed' : 'failed'
  await supabaseAdmin.from('qads_generations').update({
    status: nextStatus,
    completed_at: new Date().toISOString(),
  }).eq('id', generationId)
}
