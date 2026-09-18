// POST /api/qads/campaigns/[id]/deploy — build+validate+save the channel deploy
// payload(s) for a campaign (dry-run always), and — only when QADS_LIVE_DEPLOY=true AND
// the request body explicitly names ONE channel to confirm — execute that single
// channel's live deploy. This is the "flip to production is a config change, not a
// refactor" boundary from docs/qads-proposal.md §5.1: buildDeployPayloads and
// validateBeforeSend run unconditionally either way, and this route is the only place
// that decides whether execute-deploy.ts's create-calls actually fire.
//
// Hard rule enforced here, on top of the QADS_LIVE_DEPLOY env gate: a live deploy always
// requires body.confirmChannel to name exactly the one channel being deployed — there is
// no "deploy everything" live call. Per-step explicit confirmation, never a blanket one.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildDeployPayloads } from '@/lib/qads/deploy/build-payloads'
import { executeLiveDeploy } from '@/lib/qads/deploy/execute-deploy'
import type { QadsChannel } from '@/lib/qads/types'

interface Params { params: Promise<{ id: string }> }

interface DeployBody {
  confirmChannel?: QadsChannel // presence + QADS_LIVE_DEPLOY=true together is what authorizes a live send for that one channel
}

export async function POST(request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (!['ready_for_review', 'deployed_paused', 'failed'].includes(campaign.status)) {
    return NextResponse.json({ error: `Campaign status '${campaign.status}' is not deployable` }, { status: 409 })
  }

  let body: DeployBody = {}
  try {
    body = await request.json()
  } catch {
    // No body is fine — a plain dry-run build doesn't need one.
  }

  const buildResult = await buildDeployPayloads(campaignId)
  if (!buildResult.ok && !Object.keys(buildResult.payloadsByChannel).length) {
    return NextResponse.json({ error: buildResult.error, skipped: buildResult.skipped }, { status: 422 })
  }

  // Save/refresh the dry-run snapshot for every channel that produced a payload — this
  // is the approval-screen data (docs/qads-proposal.md §5.1), regardless of whether a
  // live deploy is also happening this request.
  for (const [channel, payload] of Object.entries(buildResult.payloadsByChannel)) {
    const { data: existingLink } = await supabaseAdmin
      .from('qads_campaign_channel_links')
      .select('id, external_campaign_id')
      .eq('campaign_id', campaignId)
      .eq('channel', channel)
      .maybeSingle()

    if (existingLink) {
      // Never clobber an already-deployed link's dry_run/external_campaign_id fields —
      // only refresh the payload snapshot for visibility.
      await supabaseAdmin
        .from('qads_campaign_channel_links')
        .update({ deploy_payload: payload, ad_account_id: payload.adAccountRowId })
        .eq('id', existingLink.id)
    } else {
      await supabaseAdmin.from('qads_campaign_channel_links').insert({
        campaign_id: campaignId,
        channel,
        ad_account_id: payload.adAccountRowId,
        deploy_payload: payload,
        dry_run: true,
      })
    }
  }

  const liveDeployEnabled = process.env.QADS_LIVE_DEPLOY === 'true'
  let liveResult: { channel: QadsChannel; ok: boolean; error?: string; externalCampaignId?: string } | null = null

  if (body.confirmChannel) {
    const payload = buildResult.payloadsByChannel[body.confirmChannel]
    if (!payload) {
      return NextResponse.json({ error: `No deployable payload was built for channel '${body.confirmChannel}'` }, { status: 422 })
    }
    if (validationErrorsFor(buildResult.validationErrors, body.confirmChannel).length) {
      return NextResponse.json({ error: 'Cannot confirm a channel with unresolved validation errors', validationErrors: buildResult.validationErrors[body.confirmChannel] }, { status: 422 })
    }
    if (!liveDeployEnabled) {
      return NextResponse.json({ error: 'QADS_LIVE_DEPLOY is not enabled on this deployment — confirmChannel has no effect while it is off', dryRun: true }, { status: 409 })
    }

    const result = await executeLiveDeploy(campaignId, userId, payload)
    liveResult = { channel: body.confirmChannel, ...result }
  }

  return NextResponse.json({
    dryRun: !liveResult,
    liveDeployEnabled,
    payloadsByChannel: buildResult.payloadsByChannel,
    validationErrors: buildResult.validationErrors,
    skipped: buildResult.skipped,
    liveResult,
  })
}

function validationErrorsFor(validationErrors: Record<string, string[]>, channel: string): string[] {
  return validationErrors[channel] ?? []
}
