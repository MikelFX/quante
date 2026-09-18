// POST /api/qads/kill-switch — store-scoped emergency stop. Sets every live channel
// campaign for the given project to PAUSED, one call, no per-campaign confirmation —
// "that's the point of a kill switch" (docs/qads-proposal.md §7). Writes one
// qads_audit_log row per campaign paused.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { getConnectedAccessToken } from '@/lib/qads/channels/access-token'
import { writeQadsAuditLog } from '@/lib/qads/audit'
import type { QadsChannel } from '@/lib/qads/types'

interface KillSwitchBody { projectId: string }

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: KillSwitchBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', body.projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: campaigns } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, status')
    .eq('project_id', body.projectId)
    .in('status', ['active', 'deployed_paused', 'deploying'])
  if (!campaigns?.length) return NextResponse.json({ ok: true, pausedCampaigns: 0, note: 'No active/deployed campaigns found for this project' })

  const results: Array<{ campaignId: string; channel: QadsChannel; ok: boolean; error?: string }> = []

  for (const campaign of campaigns) {
    const { data: links } = await supabaseAdmin
      .from('qads_campaign_channel_links')
      .select('id, channel, ad_account_id, external_campaign_id, dry_run')
      .eq('campaign_id', campaign.id)
      .eq('dry_run', false)
      .not('external_campaign_id', 'is', null)

    for (const link of links ?? []) {
      const tokenResult = await getConnectedAccessToken(link.ad_account_id)
      if (!tokenResult.ok) {
        results.push({ campaignId: campaign.id, channel: link.channel as QadsChannel, ok: false, error: tokenResult.error })
        continue
      }
      try {
        const adChannel = createAdChannel(link.channel as QadsChannel)
        await adChannel.setStatus(tokenResult.accessToken, tokenResult.adAccountExternalId, 'campaign', link.external_campaign_id as string, 'PAUSED')
        await supabaseAdmin.from('qads_campaign_channel_links').update({ external_status: 'PAUSED' }).eq('id', link.id)
        results.push({ campaignId: campaign.id, channel: link.channel as QadsChannel, ok: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[qads/kill-switch] failed to pause ${campaign.id}/${link.channel}:`, message)
        results.push({ campaignId: campaign.id, channel: link.channel as QadsChannel, ok: false, error: message })
      }
    }

    await supabaseAdmin.from('qads_campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaign.id)
    await writeQadsAuditLog({
      userId,
      campaignId: campaign.id,
      action: 'kill_switch',
      entityType: 'project',
      entityId: body.projectId,
      beforeJson: { status: campaign.status },
      afterJson: { status: 'paused', results: results.filter((r) => r.campaignId === campaign.id) },
    })
  }

  return NextResponse.json({ ok: true, pausedCampaigns: campaigns.length, results })
}
