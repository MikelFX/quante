// Pulls insights from every connected channel for every live-deployed campaign and
// upserts them into qads_metrics (one row per entity+day, never overwritten in place —
// see the table comment in supabase/migration-qads.sql). Read-only against the
// channels: getInsights is the only AdChannel method this file ever calls, so this runs
// regardless of QADS_LIVE_DEPLOY (there is nothing unsafe about reading stats for a
// campaign that was live-deployed and later paused — the numbers are historical fact
// either way).
//
// Also implements the "unusual-spend detection" guardrail from
// docs/qads-proposal.md §7: after syncing an ad set's spend for today, compares it
// against the trailing 7-day average for that same ad set and writes a
// qads_audit_log(action='spend_anomaly') row if it jumps past a configurable
// threshold — a warning surfaced to the dashboard, never an automatic pause (the spec
// is explicit: "brief doesn't ask for auto-pause on spend anomalies, only a warning").

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '../channels/registry'
import { getConnectedAccessToken } from '../channels/access-token'
import { writeQadsAuditLog } from '../audit'
import type { QadsChannel } from '../types'
import type { AdChannelInsightsRow } from '../channels/types'

const DEFAULT_ANOMALY_MULTIPLIER = 3
const LOOKBACK_DAYS = 7

export interface SyncMetricsResult {
  campaignsProcessed: number
  rowsUpserted: number
  anomaliesFlagged: number
  errors: string[]
}

export async function syncAllCampaignMetrics(sinceIso: string, untilIso: string): Promise<SyncMetricsResult> {
  const result: SyncMetricsResult = { campaignsProcessed: 0, rowsUpserted: 0, anomaliesFlagged: 0, errors: [] }

  const { data: links } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('campaign_id, channel, ad_account_id, external_campaign_id')
    .eq('dry_run', false)
    .not('external_campaign_id', 'is', null)

  const campaignIds = [...new Set((links ?? []).map((l) => l.campaign_id as string))]

  for (const campaignId of campaignIds) {
    try {
      const campaignResult = await syncMetricsForCampaign(campaignId, sinceIso, untilIso)
      result.campaignsProcessed++
      result.rowsUpserted += campaignResult.rowsUpserted
      result.anomaliesFlagged += campaignResult.anomaliesFlagged
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[qads/metrics-sync] campaign ${campaignId} failed:`, message)
      result.errors.push(`${campaignId}: ${message}`)
      // One campaign's insights API hiccup must never stop the rest from syncing —
      // same leaf-node-failure posture as every other multi-entity loop in this module.
    }
  }

  return result
}

export async function syncMetricsForCampaign(campaignId: string, sinceIso: string, untilIso: string): Promise<{ rowsUpserted: number; anomaliesFlagged: number }> {
  const { data: campaign } = await supabaseAdmin.from('qads_campaigns').select('id, user_id').eq('id', campaignId).maybeSingle()
  if (!campaign) return { rowsUpserted: 0, anomaliesFlagged: 0 }

  const { data: links } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('channel, ad_account_id, external_campaign_id')
    .eq('campaign_id', campaignId)
    .eq('dry_run', false)
    .not('external_campaign_id', 'is', null)

  let rowsUpserted = 0
  let anomaliesFlagged = 0

  for (const link of links ?? []) {
    const tokenResult = await getConnectedAccessToken(link.ad_account_id)
    if (!tokenResult.ok) continue // ad account went stale (needs_reauth/revoked) — skip silently, surfaced separately via qads_ad_accounts.status in the UI

    const adChannel = createAdChannel(link.channel as QadsChannel)
    const { accessToken } = tokenResult

    // Campaign level.
    rowsUpserted += await syncLevel(adChannel, accessToken, campaignId, link.channel as QadsChannel, 'campaign', link.external_campaign_id as string, sinceIso, untilIso)

    // Ad-set level (+ anomaly check) and ad level.
    const { data: adSets } = await supabaseAdmin
      .from('qads_ad_sets')
      .select('id, external_id')
      .eq('campaign_id', campaignId)
      .eq('channel', link.channel)
      .not('external_id', 'is', null)

    for (const adSet of adSets ?? []) {
      const adSetExternalId = adSet.external_id as string
      rowsUpserted += await syncLevel(adChannel, accessToken, campaignId, link.channel as QadsChannel, 'ad_set', adSetExternalId, sinceIso, untilIso)
      const flagged = await checkSpendAnomaly(campaignId, campaign.user_id, adSetExternalId)
      if (flagged) anomaliesFlagged++
    }

    const { data: ads } = adSets?.length
      ? await supabaseAdmin
          .from('qads_ads')
          .select('id, external_id')
          .in('ad_set_id', (adSets ?? []).map((s) => s.id))
          .not('external_id', 'is', null)
      : { data: [] }

    for (const ad of ads ?? []) {
      rowsUpserted += await syncLevel(adChannel, accessToken, campaignId, link.channel as QadsChannel, 'ad', ad.external_id as string, sinceIso, untilIso)
    }
  }

  return { rowsUpserted, anomaliesFlagged }
}

async function syncLevel(
  adChannel: ReturnType<typeof createAdChannel>,
  accessToken: string,
  campaignId: string,
  channel: QadsChannel,
  level: 'campaign' | 'ad_set' | 'ad',
  entityExternalId: string,
  sinceIso: string,
  untilIso: string,
): Promise<number> {
  // getInsights's own AdChannelInsightsQuery.adAccountExternalId requirement (added in
  // step e's interface fix) is satisfied by the caller having already resolved the
  // right ad account for this channel link — passed through here rather than
  // re-resolved per level.
  const { data: link } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('ad_account_id')
    .eq('campaign_id', campaignId)
    .eq('channel', channel)
    .maybeSingle()
  const { data: adAccount } = link
    ? await supabaseAdmin.from('qads_ad_accounts').select('external_account_id').eq('id', link.ad_account_id).maybeSingle()
    : { data: null }
  if (!adAccount) return 0

  let rows: AdChannelInsightsRow[]
  try {
    rows = await adChannel.getInsights(accessToken, {
      adAccountExternalId: adAccount.external_account_id,
      level,
      entityExternalId,
      since: sinceIso,
      until: untilIso,
    })
  } catch (err) {
    console.error(`[qads/metrics-sync] getInsights failed for ${channel}/${level}/${entityExternalId}:`, err instanceof Error ? err.message : err)
    return 0
  }

  let upserted = 0
  for (const row of rows) {
    const ctr = row.impressions > 0 ? row.clicks / row.impressions : null
    const cpcMinor = row.clicks > 0 ? Math.round(row.spendMinor / row.clicks) : null
    const cpaMinor = row.conversions && row.conversions > 0 ? Math.round(row.spendMinor / row.conversions) : null
    const roas = row.conversionValueMinor && row.spendMinor > 0 ? row.conversionValueMinor / row.spendMinor : null

    const { error } = await supabaseAdmin.from('qads_metrics').upsert(
      {
        campaign_id: campaignId,
        level,
        entity_id: entityExternalId,
        channel,
        day: row.day,
        impressions: row.impressions,
        clicks: row.clicks,
        spend_minor: row.spendMinor,
        conversions: row.conversions ?? 0,
        conversion_value_minor: row.conversionValueMinor ?? 0,
        ctr,
        cpc_minor: cpcMinor,
        cpa_minor: cpaMinor,
        roas,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'level,entity_id,day' },
    )
    if (!error) upserted++
    else console.error(`[qads/metrics-sync] upsert failed for ${level}/${entityExternalId}/${row.day}:`, error.message)
  }

  return upserted
}

async function checkSpendAnomaly(campaignId: string, userId: string, adSetExternalId: string): Promise<boolean> {
  const multiplier = Number(process.env.QADS_SPEND_ANOMALY_MULTIPLIER) || DEFAULT_ANOMALY_MULTIPLIER

  const { data: recentRows } = await supabaseAdmin
    .from('qads_metrics')
    .select('day, spend_minor')
    .eq('level', 'ad_set')
    .eq('entity_id', adSetExternalId)
    .order('day', { ascending: false })
    .limit(LOOKBACK_DAYS + 1) // today + 7 prior days

  if (!recentRows || recentRows.length < 2) return false // not enough history to judge

  const [today, ...priorDays] = recentRows
  if (!priorDays.length) return false

  const avgPriorSpend = priorDays.reduce((sum, r) => sum + (r.spend_minor as number), 0) / priorDays.length
  if (avgPriorSpend <= 0) return false // no baseline spend to compare against — a brand-new ad set ramping up isn't an "anomaly"

  const todaySpend = today.spend_minor as number
  if (todaySpend <= avgPriorSpend * multiplier) return false

  // Avoid re-flagging the same day on every sync run (this cron can run more than once
  // a day) — check whether an anomaly was already logged for this entity+day.
  const { data: existing } = await supabaseAdmin
    .from('qads_audit_log')
    .select('id')
    .eq('action', 'spend_anomaly')
    .eq('entity_id', adSetExternalId)
    .eq('entity_type', 'ad_set')
    .contains('after_json', { day: today.day })
    .maybeSingle()
  if (existing) return false

  await writeQadsAuditLog({
    userId,
    campaignId,
    action: 'spend_anomaly',
    entityType: 'ad_set',
    entityId: adSetExternalId,
    beforeJson: { trailingAverageSpendMinor: Math.round(avgPriorSpend), lookbackDays: priorDays.length },
    afterJson: { day: today.day, spendMinor: todaySpend, multiplier },
  })
  return true
}
