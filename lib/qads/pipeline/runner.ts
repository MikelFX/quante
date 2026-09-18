// Executes the Phase-1 portion of the Qads job graph (brand_context -> strategy ->
// angles -> ad_sets -> ad_copy) for a single campaign row that already exists in
// 'generating' status. Durable-by-row, not by an in-memory pipeline object: each stage's
// result is persisted the moment it succeeds (qads_angles/qads_ad_sets/qads_ads rows), and
// qads_campaigns.pipeline_state is updated after every stage so a crash mid-run leaves
// enough state behind to know exactly how far it got — same durability principle
// generation_jobs uses for store generation (see docs/qads-proposal.md §3.2).
//
// Called synchronously from POST /api/qads/campaigns for Phase 1 (no background job
// queue yet — a single Claude call plus a handful of inserts is well within a normal
// request's time budget; image/video generation in later steps is what actually needs
// async job handling, per the Higgsfield submit/poll/webhook lifecycle).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { runStrategyNode } from './nodes/strategy'
import { persistAngles } from './nodes/angles'
import { persistAdSets } from './nodes/adsets'
import { persistAds } from './nodes/copy'
import { refundCredits } from '../credits'
import type { ShopAdBrandContext, CampaignGoal, QadsChannel } from '../types'

export interface RunCampaignGenerationParams {
  campaignId: string
  userId: string
  brandContext: ShopAdBrandContext
  goal: CampaignGoal
  channels: QadsChannel[]
  budgetMinor: number
  currency: string
  durationDays: number
  brief: string
  creditsReserved: number
}

export interface RunCampaignGenerationResult {
  ok: boolean
  error?: string
}

export async function runCampaignGeneration(params: RunCampaignGenerationParams): Promise<RunCampaignGenerationResult> {
  const { campaignId, userId, creditsReserved } = params

  await updatePipelineState(campaignId, { brand_context: 'completed', strategy: 'running' })

  const strategyResult = await runStrategyNode({
    brandContext: params.brandContext,
    goal: params.goal,
    channels: params.channels,
    budgetMinor: params.budgetMinor,
    currency: params.currency,
    durationDays: params.durationDays,
    brief: params.brief,
  })

  if (!strategyResult.ok) {
    await failCampaign(campaignId, userId, creditsReserved, strategyResult.error)
    return { ok: false, error: strategyResult.error }
  }

  const { output } = strategyResult
  await updatePipelineState(campaignId, { strategy: 'completed', angles: 'running' })

  const anglesResult = await persistAngles(campaignId, output.angles)
  if (!anglesResult.ok) {
    await failCampaign(campaignId, userId, creditsReserved, anglesResult.error)
    return { ok: false, error: anglesResult.error }
  }

  await updatePipelineState(campaignId, { angles: 'completed', ad_sets: 'running' })

  const adSetsResult = await persistAdSets({
    campaignId,
    adSets: output.adSets,
    angles: anglesResult.angles,
    totalBudgetMinor: params.budgetMinor,
  })
  if (!adSetsResult.ok) {
    await failCampaign(campaignId, userId, creditsReserved, adSetsResult.error)
    return { ok: false, error: adSetsResult.error }
  }

  await updatePipelineState(campaignId, { ad_sets: 'completed', ad_copy: 'running' })

  const adsResult = await persistAds({ ads: output.ads, adSets: adSetsResult.adSets })
  if (!adsResult.ok) {
    // Ad sets already exist and are valid even without copy — this is a leaf-node
    // failure, not a campaign-wide one ("selhání jednoho assetu nesmí shodit kampaň" —
    // docs/qads-proposal.md §3.2). Campaign still moves to ready_for_review; the merchant
    // can trigger a copy regenerate for the affected ad sets from the UI later (step j).
    console.warn(`[qads/runner] campaign ${campaignId}: ad copy persistence failed (${adsResult.error}), continuing with ad sets only`)
  }

  await supabaseAdmin.from('qads_campaigns').update({
    status: 'ready_for_review',
    strategy: output.strategy,
    pipeline_state: {
      brand_context: 'completed', strategy: 'completed', angles: 'completed',
      ad_sets: 'completed', ad_copy: adsResult.ok ? 'completed' : 'failed',
    },
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId)

  return { ok: true }
}

async function updatePipelineState(campaignId: string, patch: Record<string, string>): Promise<void> {
  const { data } = await supabaseAdmin.from('qads_campaigns').select('pipeline_state').eq('id', campaignId).maybeSingle()
  const current = (data?.pipeline_state ?? {}) as Record<string, string>
  await supabaseAdmin.from('qads_campaigns').update({
    pipeline_state: { ...current, ...patch },
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId)
}

// A hard pipeline failure (strategy call unrepairable, or a required persistence step
// failing) marks the campaign failed and refunds every credit reserved for it — matches
// CLAUDE.md §4.4's "reject + auto-repair on failure" / §5's refund-on-failure rule. Partial
// asset-level failures (see the ad-copy branch above) do NOT go through this path.
async function failCampaign(campaignId: string, userId: string, creditsReserved: number, error: string): Promise<void> {
  console.error(`[qads/runner] campaign ${campaignId} failed: ${error}`)
  await supabaseAdmin.from('qads_campaigns').update({
    status: 'failed',
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId)

  await refundCredits({
    userId,
    amount: creditsReserved,
    campaignId,
    reason: 'qads_campaign_generation_failed',
  })
}
