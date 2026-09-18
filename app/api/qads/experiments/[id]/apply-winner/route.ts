// POST /api/qads/experiments/[id]/apply-winner — the ONLY path that concludes an
// experiment and acts on the result. Never triggered automatically by GET's
// significance computation (docs/qads-proposal.md §8: "no auto-conclusion is allowed to
// fire the reallocate-budget path"). Requires body.confirm === true.
//
// Re-computes significance itself rather than trusting a client-supplied winner id or a
// possibly-stale DB snapshot — the winner applied is always the one the numbers support
// at the moment this is called.
//
// "Applying the winner" is defined here as: pause every non-winning variant that is
// already live-deployed (stop them from spending further) and leave the winner running
// untouched. The proposal doesn't specify an exact budget-reallocation formula for the
// winner (an open item), so this deliberately does the unambiguous, safe half of that —
// stopping the losers — rather than inventing a specific reallocation percentage.
// Variants that were never live-deployed need no channel action; there's nothing to
// pause.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { getConnectedAccessToken } from '@/lib/qads/channels/access-token'
import { computeExperimentSignificance, resolveVariantExternalIds, type ExperimentVariant } from '@/lib/qads/experiments/significance'
import { writeQadsAuditLog } from '@/lib/qads/audit'
import type { QadsChannel } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }
interface ApplyWinnerBody { confirm: boolean }

export async function POST(request: Request, { params }: Params) {
  const { id: experimentId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ApplyWinnerBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'apply-winner requires confirm: true — this pauses the losing variant(s)' }, { status: 400 })
  }

  const { data: experiment } = await supabaseAdmin
    .from('qads_experiments')
    .select('id, campaign_id, variants, status, qads_campaigns!inner(user_id)')
    .eq('id', experimentId)
    .eq('qads_campaigns.user_id', userId)
    .maybeSingle()
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })
  if (experiment.status === 'concluded') return NextResponse.json({ error: 'Experiment is already concluded' }, { status: 409 })

  const significance = await computeExperimentSignificance(experimentId)
  if ('error' in significance) return NextResponse.json({ error: significance.error }, { status: 422 })
  if (!significance.comparison) {
    return NextResponse.json({ error: 'No statistically significant winner yet — cannot apply a winner that the numbers do not support', minSampleNote: significance.minSampleNote }, { status: 422 })
  }

  const { winnerVariantId, confidence } = significance.comparison
  const variants = experiment.variants as ExperimentVariant[]
  const losers = variants.filter((v) => v.id !== winnerVariantId)

  const pauseResults: Array<{ variantId: string; ok: boolean; note: string }> = []

  for (const loser of losers) {
    const channel = await getChannelForVariant(loser)
    if (!channel) {
      pauseResults.push({ variantId: loser.id, ok: true, note: 'Could not resolve a channel for this variant — skipped' })
      continue
    }

    const externalIds = await resolveVariantExternalIds(loser)
    if (!externalIds.length) {
      pauseResults.push({ variantId: loser.id, ok: true, note: 'Not live-deployed — nothing to pause' })
      continue
    }

    const { data: link } = await supabaseAdmin
      .from('qads_campaign_channel_links')
      .select('ad_account_id')
      .eq('campaign_id', experiment.campaign_id)
      .eq('channel', channel)
      .maybeSingle()
    const tokenResult = link ? await getConnectedAccessToken(link.ad_account_id) : null

    if (!tokenResult || !tokenResult.ok) {
      pauseResults.push({ variantId: loser.id, ok: false, note: tokenResult ? tokenResult.error : 'No ad account link found for this channel' })
      continue
    }

    const adChannel = createAdChannel(channel)
    const level = loser.refType === 'ad_set' ? 'ad_set' : 'ad'
    let allOk = true
    for (const externalId of externalIds) {
      try {
        await adChannel.setStatus(tokenResult.accessToken, tokenResult.adAccountExternalId, level, externalId, 'PAUSED')
      } catch (err) {
        allOk = false
        console.error(`[qads/apply-winner] failed to pause ${level} ${externalId}:`, err instanceof Error ? err.message : err)
      }
    }
    if (loser.refType === 'ad_set') {
      await supabaseAdmin.from('qads_ad_sets').update({ status: 'paused', external_status: allOk ? 'PAUSED' : undefined }).eq('id', loser.refId)
    }
    pauseResults.push({ variantId: loser.id, ok: allOk, note: allOk ? 'Paused' : 'One or more pause calls failed — check logs' })
  }

  await supabaseAdmin
    .from('qads_experiments')
    .update({
      status: 'concluded',
      result: { winnerVariantId, confidence, appliedAt: new Date().toISOString() },
    })
    .eq('id', experimentId)

  await writeQadsAuditLog({
    userId,
    campaignId: experiment.campaign_id,
    action: 'experiment_apply',
    entityType: 'experiment',
    entityId: experimentId,
    beforeJson: { status: experiment.status },
    afterJson: { winnerVariantId, confidence, pauseResults },
  })

  return NextResponse.json({ ok: true, winnerVariantId, confidence, pauseResults })
}

async function getChannelForVariant(variant: ExperimentVariant): Promise<QadsChannel | null> {
  if (variant.refType === 'ad_set') {
    const { data } = await supabaseAdmin.from('qads_ad_sets').select('channel').eq('id', variant.refId).maybeSingle()
    return (data?.channel as QadsChannel) ?? null
  }
  if (variant.refType === 'ad') {
    const { data } = await supabaseAdmin
      .from('qads_ads')
      .select('qads_ad_sets!inner(channel)')
      .eq('id', variant.refId)
      .maybeSingle()
    return (data as unknown as { qads_ad_sets: { channel: QadsChannel } } | null)?.qads_ad_sets?.channel ?? null
  }
  // 'creative' — take the channel of whichever ad set the first matching ad belongs to.
  const { data } = await supabaseAdmin
    .from('qads_ads')
    .select('qads_ad_sets!inner(channel)')
    .eq('creative_id', variant.refId)
    .limit(1)
    .maybeSingle()
  return (data as unknown as { qads_ad_sets: { channel: QadsChannel } } | null)?.qads_ad_sets?.channel ?? null
}
