// POST /api/qads/campaigns/[id]/activate — flips one channel's already-live-deployed
// campaign/ad-sets/ads to ACTIVE. Requires the channel to have actually gone through a
// live deploy (qads_campaign_channel_links.dry_run = false, external_campaign_id set —
// see lib/qads/deploy/execute-deploy.ts) AND body.confirm === true — activation spends
// real money on the merchant's own ad account from this point, so it gets the same
// "explicit per-step confirmation, no blanket action" treatment as a live deploy itself.
//
// Guardrail-checked BEFORE any channel call, per docs/qads-proposal.md §7: a request
// that would push this campaign's (or the user's account-wide) daily spend rate over a
// configured cap is rejected before touching the channel API at all.
//
// Activating each level independently is safe by construction: Meta/TikTok only spend
// once campaign AND ad set AND ad are all ACTIVE, so a partial failure here (e.g. the
// campaign flips but one ad set's call errors) leaves that ad set's ads unable to spend
// — no rollback needed, unlike the deploy layer's create path.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { getConnectedAccessToken } from '@/lib/qads/channels/access-token'
import { checkBudgetGuardrails, dailyEquivalentMinor } from '@/lib/qads/budget/guardrails'
import { writeQadsAuditLog } from '@/lib/qads/audit'
import type { QadsChannel } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }
interface ActivateBody { channel: QadsChannel; confirm: boolean }

export async function POST(request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ActivateBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 })
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Activation requires confirm: true — this spends real money on the connected ad account' }, { status: 400 })
  }

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, duration_days, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: link } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('id, ad_account_id, external_campaign_id, external_status, dry_run')
    .eq('campaign_id', campaignId)
    .eq('channel', body.channel)
    .maybeSingle()
  if (!link || link.dry_run || !link.external_campaign_id) {
    return NextResponse.json({ error: `Channel '${body.channel}' has not been live-deployed yet — deploy it first` }, { status: 409 })
  }

  const { data: adSets } = await supabaseAdmin
    .from('qads_ad_sets')
    .select('id, external_id, budget_minor, budget_type')
    .eq('campaign_id', campaignId)
    .eq('channel', body.channel)
    .not('external_id', 'is', null)
  const deployedAdSets = adSets ?? []
  if (!deployedAdSets.length) {
    return NextResponse.json({ error: `No deployed ad sets found for channel '${body.channel}'` }, { status: 409 })
  }

  const campaignDailyMinorAfterChange = deployedAdSets.reduce(
    (sum, s) => sum + dailyEquivalentMinor(s.budget_minor as number, s.budget_type as 'daily' | 'lifetime', campaign.duration_days),
    0,
  )
  const guardrail = await checkBudgetGuardrails({ userId, campaignId, campaignDailyMinorAfterChange })
  if (!guardrail.ok) return NextResponse.json({ error: guardrail.error }, { status: 402 })

  const tokenResult = await getConnectedAccessToken(link.ad_account_id)
  if (!tokenResult.ok) return NextResponse.json({ error: tokenResult.error }, { status: 409 })
  const { accessToken, adAccountExternalId } = tokenResult
  const adChannel = createAdChannel(body.channel)

  const errors: string[] = []

  try {
    await adChannel.setStatus(accessToken, adAccountExternalId, 'campaign', link.external_campaign_id, 'ACTIVE')
    await supabaseAdmin.from('qads_campaign_channel_links').update({ external_status: 'ACTIVE' }).eq('id', link.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qads/activate] campaign-level activate failed for ${campaignId}/${body.channel}:`, message)
    return NextResponse.json({ error: `Failed to activate campaign on ${body.channel}: ${message}` }, { status: 502 })
  }

  const { data: adsData } = await supabaseAdmin
    .from('qads_ads')
    .select('id, external_id')
    .in('ad_set_id', deployedAdSets.map((s) => s.id))
    .not('external_id', 'is', null)
  const deployedAds = adsData ?? []

  for (const adSet of deployedAdSets) {
    try {
      await adChannel.setStatus(accessToken, adAccountExternalId, 'ad_set', adSet.external_id as string, 'ACTIVE')
      await supabaseAdmin.from('qads_ad_sets').update({ status: 'active', external_status: 'ACTIVE' }).eq('id', adSet.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`ad set ${adSet.id}: ${message}`)
    }
  }

  for (const ad of deployedAds) {
    try {
      await adChannel.setStatus(accessToken, adAccountExternalId, 'ad', ad.external_id as string, 'ACTIVE')
      await supabaseAdmin.from('qads_ads').update({ external_status: 'ACTIVE' }).eq('id', ad.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`ad ${ad.id}: ${message}`)
    }
  }

  await supabaseAdmin.from('qads_campaigns').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', campaignId)
  await writeQadsAuditLog({
    userId,
    campaignId,
    action: 'activate',
    entityType: 'channel',
    entityId: body.channel,
    beforeJson: { status: campaign.status },
    afterJson: { status: 'active', channel: body.channel, partialErrors: errors.length ? errors : undefined },
  })

  return NextResponse.json({ ok: true, activatedAdSets: deployedAdSets.length - errors.length, totalAdSets: deployedAdSets.length, errors })
}
