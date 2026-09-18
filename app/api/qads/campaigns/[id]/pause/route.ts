// POST /api/qads/campaigns/[id]/pause — flips one channel's live campaign/ad-sets/ads
// back to PAUSED. No guardrail check (pausing never increases spend) and no
// confirm:true requirement (pausing is the safe direction — see the kill-switch route
// for the same reasoning applied account-wide).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '@/lib/qads/channels/registry'
import { getConnectedAccessToken } from '@/lib/qads/channels/access-token'
import { writeQadsAuditLog } from '@/lib/qads/audit'
import type { QadsChannel } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }
interface PauseBody { channel: QadsChannel }

export async function POST(request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: PauseBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body.channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: link } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('id, ad_account_id, external_campaign_id, dry_run')
    .eq('campaign_id', campaignId)
    .eq('channel', body.channel)
    .maybeSingle()
  if (!link || link.dry_run || !link.external_campaign_id) {
    return NextResponse.json({ error: `Channel '${body.channel}' has no live campaign to pause` }, { status: 409 })
  }

  const tokenResult = await getConnectedAccessToken(link.ad_account_id)
  if (!tokenResult.ok) return NextResponse.json({ error: tokenResult.error }, { status: 409 })
  const { accessToken, adAccountExternalId } = tokenResult
  const adChannel = createAdChannel(body.channel)

  try {
    // Pausing the campaign alone stops delivery for every ad set/ad beneath it on both
    // Meta and TikTok — no need to also individually pause every ad set/ad for the
    // "stop spending" outcome, unlike activate which needs every level ACTIVE.
    await adChannel.setStatus(accessToken, adAccountExternalId, 'campaign', link.external_campaign_id, 'PAUSED')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qads/pause] campaign-level pause failed for ${campaignId}/${body.channel}:`, message)
    return NextResponse.json({ error: `Failed to pause campaign on ${body.channel}: ${message}` }, { status: 502 })
  }

  await supabaseAdmin.from('qads_campaign_channel_links').update({ external_status: 'PAUSED' }).eq('id', link.id)
  await supabaseAdmin.from('qads_ad_sets').update({ status: 'paused' }).eq('campaign_id', campaignId).eq('channel', body.channel)
  await supabaseAdmin.from('qads_campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaignId)
  await writeQadsAuditLog({
    userId,
    campaignId,
    action: 'pause',
    entityType: 'channel',
    entityId: body.channel,
    beforeJson: { status: campaign.status },
    afterJson: { status: 'paused', channel: body.channel },
  })

  return NextResponse.json({ ok: true })
}
