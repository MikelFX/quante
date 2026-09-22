// GET /api/qads/cron/sweep-stuck — Vercel cron backup path for Higgsfield
// webhook drops. Every qads_items row that's been in queued/generating for
// more than STUCK_AFTER_MINUTES with a stored higgsfield_status_url gets
// re-polled via Higgsfield's status endpoint; if we get a terminal state,
// we apply the same completion / refund logic the webhook route would.
//
// Never fires more than one poll per item per cron tick — the daily
// (Hobby-plan-friendly) schedule handles this at the tick boundary; if
// upgraded to Pro / more frequent, add a lastPolledAt column and gate on it.
//
// Vercel auth: same "Authorization: Bearer CRON_SECRET" pattern the other
// cron endpoints in this repo use.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getHiggsfieldCredentialsFromEnv, createHiggsfieldProvider } from '@/lib/qads/media/providers/higgsfield'
import { refundGeneratorCredits } from '@/lib/qads/credits'

export const maxDuration = 300

const STUCK_AFTER_MINUTES = 10
const MAX_ITEMS_PER_RUN = 200

export async function GET(request: Request) {
  // Vercel sends the secret as Authorization: Bearer <CRON_SECRET> when set
  // in project env. Allow either unset (dev / local runs) or matching.
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (cronSecret) {
    const authHeader = request.headers.get('authorization') ?? ''
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const creds = getHiggsfieldCredentialsFromEnv()
  if (!creds) return NextResponse.json({ error: 'Higgsfield not configured' }, { status: 500 })
  const provider = createHiggsfieldProvider(creds)

  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString()
  const { data: stuck } = await supabaseAdmin
    .from('qads_items')
    .select('id, generation_id, user_id, kind, higgsfield_status_url, credits_charged, status')
    .in('status', ['queued', 'generating'])
    .not('higgsfield_status_url', 'is', null)
    .lt('created_at', cutoff)
    .limit(MAX_ITEMS_PER_RUN)

  const summary = { polled: 0, completed: 0, failed: 0, still_generating: 0, errors: 0 }

  for (const item of stuck ?? []) {
    summary.polled++
    try {
      const status = await provider.getStatus(item.higgsfield_status_url as string)
      if (status.status === 'completed' && status.assets?.length) {
        try {
          const asset = status.assets[0]
          const res = await fetch(asset.url)
          if (!res.ok) throw new Error(`asset fetch ${res.status}`)
          const buffer = Buffer.from(await res.arrayBuffer())
          const mimeType = asset.contentType || res.headers.get('content-type') || 'application/octet-stream'
          const ext = (mimeType.split('/')[1]?.split(';')[0] || 'bin').replace('jpeg', 'jpg')
          const path = `${item.user_id}/${item.generation_id}/${item.id}.${ext}`
          const { error: uploadErr } = await supabaseAdmin.storage.from('qads-outputs').upload(path, buffer, {
            contentType: mimeType, upsert: true,
          })
          if (uploadErr) throw new Error(uploadErr.message)
          await supabaseAdmin.from('qads_items').update({
            status: 'completed',
            storage_bucket: 'qads-outputs',
            storage_path: path,
            mime_type: mimeType,
            completed_at: new Date().toISOString(),
          }).eq('id', item.id as string)
          summary.completed++
        } catch (copyErr) {
          const message = copyErr instanceof Error ? copyErr.message : 'copy_failed'
          await supabaseAdmin.from('qads_items').update({
            status: 'failed',
            error_message: message.slice(0, 500),
            completed_at: new Date().toISOString(),
          }).eq('id', item.id as string)
          await refundGeneratorCredits({
            userId: item.user_id as string,
            amount: item.credits_charged as number,
            generationId: item.generation_id as string,
            reason: 'qads_item_copy_failed',
          })
          summary.failed++
        }
      } else if (status.status === 'failed' || status.status === 'canceled' || status.status === 'nsfw') {
        const newStatus = status.status === 'nsfw' ? 'nsfw' : 'failed'
        await supabaseAdmin.from('qads_items').update({
          status: newStatus,
          error_message: (status.error ?? `provider status: ${status.status}`).slice(0, 500),
          completed_at: new Date().toISOString(),
        }).eq('id', item.id as string)
        await refundGeneratorCredits({
          userId: item.user_id as string,
          amount: item.credits_charged as number,
          generationId: item.generation_id as string,
          reason: newStatus === 'nsfw' ? 'qads_item_nsfw' : 'qads_item_generation_failed',
        })
        summary.failed++
      } else {
        summary.still_generating++
      }
      await maybeCompleteGeneration(item.generation_id as string)
    } catch (err) {
      summary.errors++
      console.error(`[qads/sweep-stuck] item ${item.id} poll error:`, err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, summary })
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
  const nextStatus = anyCompleted && anyFailed ? 'partial' : anyCompleted ? 'completed' : 'failed'
  await supabaseAdmin.from('qads_generations').update({
    status: nextStatus,
    completed_at: new Date().toISOString(),
  }).eq('id', generationId)
}
