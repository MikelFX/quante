// GET /api/qads/campaigns/[id]/metrics — dashboard data for one campaign: campaign-level
// daily timeseries (for a chart), per-channel/per-day totals, and any spend_anomaly
// flags raised by the sync cron (lib/qads/metrics/sync.ts). The actual dashboard UI is
// step (j) — this route is the data source it will read from.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface Params { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const days = Math.min(90, Math.max(1, Number(searchParams.get('days')) || 30))
  const sinceDate = new Date()
  sinceDate.setUTCDate(sinceDate.getUTCDate() - days)
  const since = sinceDate.toISOString().slice(0, 10)

  const { data: campaignLevelRows } = await supabaseAdmin
    .from('qads_metrics')
    .select('channel, day, impressions, clicks, spend_minor, conversions, conversion_value_minor, ctr, cpc_minor, cpa_minor, roas')
    .eq('campaign_id', campaignId)
    .eq('level', 'campaign')
    .gte('day', since)
    .order('day', { ascending: true })

  const totals = (campaignLevelRows ?? []).reduce(
    (acc, r) => ({
      impressions: acc.impressions + (r.impressions as number),
      clicks: acc.clicks + (r.clicks as number),
      spendMinor: acc.spendMinor + (r.spend_minor as number),
      conversions: acc.conversions + (r.conversions as number),
      conversionValueMinor: acc.conversionValueMinor + (r.conversion_value_minor as number),
    }),
    { impressions: 0, clicks: 0, spendMinor: 0, conversions: 0, conversionValueMinor: 0 },
  )

  const { data: anomalies } = await supabaseAdmin
    .from('qads_audit_log')
    .select('id, entity_id, before_json, after_json, created_at')
    .eq('campaign_id', campaignId)
    .eq('action', 'spend_anomaly')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    since,
    totals: {
      ...totals,
      ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
      cpcMinor: totals.clicks > 0 ? Math.round(totals.spendMinor / totals.clicks) : null,
      cpaMinor: totals.conversions > 0 ? Math.round(totals.spendMinor / totals.conversions) : null,
      roas: totals.spendMinor > 0 ? totals.conversionValueMinor / totals.spendMinor : null,
    },
    dailySeries: campaignLevelRows ?? [],
    spendAnomalies: anomalies ?? [],
  })
}
