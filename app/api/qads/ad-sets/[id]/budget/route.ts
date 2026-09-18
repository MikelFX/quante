// PATCH /api/qads/ad-sets/[id]/budget — change one ad set's budget (and/or budget
// type). Guardrail-checked before touching the channel (docs/qads-proposal.md §7).
// Always writes the new value to qads_ad_sets regardless of live-deploy state, and
// additionally calls the channel's updateBudget only if the ad set has already been
// live-deployed (external_id set) — a still-dry-run ad set has nothing to update on the
// channel side yet, the DB row IS the source of truth until deploy.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { getConnectedAccessToken } from '@/lib/qads/channels/access-token'
import { checkBudgetGuardrails, dailyEquivalentMinor } from '@/lib/qads/budget/guardrails'
import { writeQadsAuditLog } from '@/lib/qads/audit'
import type { QadsChannel } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }
interface BudgetBody { budgetMinor: number; budgetType?: 'daily' | 'lifetime' }

export async function PATCH(request: Request, { params }: Params) {
  const { id: adSetId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: BudgetBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!Number.isFinite(body.budgetMinor) || body.budgetMinor <= 0) {
    return NextResponse.json({ error: 'budgetMinor must be a positive number' }, { status: 400 })
  }

  const { data: adSet } = await supabaseAdmin
    .from('qads_ad_sets')
    .select('id, campaign_id, channel, external_id, budget_minor, budget_type, qads_campaigns!inner(id, user_id, duration_days)')
    .eq('id', adSetId)
    .eq('qads_campaigns.user_id', userId)
    .maybeSingle()
  if (!adSet) return NextResponse.json({ error: 'Ad set not found' }, { status: 404 })

  const campaign = (adSet as unknown as { qads_campaigns: { id: string; user_id: string; duration_days: number } }).qads_campaigns
  const newBudgetType = body.budgetType ?? (adSet.budget_type as 'daily' | 'lifetime')

  // Guardrail check: total daily-equivalent spend across every OTHER deployed ad set in
  // this same campaign, plus this ad set's proposed new budget.
  const { data: siblingAdSets } = await supabaseAdmin
    .from('qads_ad_sets')
    .select('id, budget_minor, budget_type')
    .eq('campaign_id', adSet.campaign_id)
    .not('external_id', 'is', null)
    .neq('id', adSetId)
  const siblingDailyMinor = (siblingAdSets ?? []).reduce(
    (sum, s) => sum + dailyEquivalentMinor(s.budget_minor as number, s.budget_type as 'daily' | 'lifetime', campaign.duration_days),
    0,
  )
  const thisDailyMinor = dailyEquivalentMinor(body.budgetMinor, newBudgetType, campaign.duration_days)
  const guardrail = await checkBudgetGuardrails({
    userId,
    campaignId: adSet.campaign_id,
    campaignDailyMinorAfterChange: siblingDailyMinor + thisDailyMinor,
  })
  if (!guardrail.ok) return NextResponse.json({ error: guardrail.error }, { status: 402 })

  const before = { budgetMinor: adSet.budget_minor, budgetType: adSet.budget_type }

  if (adSet.external_id) {
    const { data: link } = await supabaseAdmin
      .from('qads_campaign_channel_links')
      .select('ad_account_id')
      .eq('campaign_id', adSet.campaign_id)
      .eq('channel', adSet.channel)
      .maybeSingle()
    if (!link) return NextResponse.json({ error: 'No ad account link found for this ad set’s channel' }, { status: 409 })

    const tokenResult = await getConnectedAccessToken(link.ad_account_id)
    if (!tokenResult.ok) return NextResponse.json({ error: tokenResult.error }, { status: 409 })

    try {
      const adChannel = createAdChannel(adSet.channel as QadsChannel)
      await adChannel.updateBudget(tokenResult.accessToken, tokenResult.adAccountExternalId, adSet.external_id, body.budgetMinor, newBudgetType)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[qads/ad-sets/budget] channel update failed for ${adSetId}:`, message)
      return NextResponse.json({ error: `Failed to update budget on ${adSet.channel}: ${message}` }, { status: 502 })
    }
  }

  await supabaseAdmin.from('qads_ad_sets').update({ budget_minor: body.budgetMinor, budget_type: newBudgetType }).eq('id', adSetId)
  await writeQadsAuditLog({
    userId,
    campaignId: adSet.campaign_id,
    action: 'budget_change',
    entityType: 'ad_set',
    entityId: adSetId,
    beforeJson: before,
    afterJson: { budgetMinor: body.budgetMinor, budgetType: newBudgetType },
  })

  return NextResponse.json({ ok: true })
}
