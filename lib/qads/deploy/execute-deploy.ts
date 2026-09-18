// executeLiveDeploy — the QADS_LIVE_DEPLOY-gated half of docs/qads-proposal.md §5.1.
// Never called unless QADS_LIVE_DEPLOY is set AND the caller (the deploy route) has
// already confirmed the merchant explicitly approved deploying THIS SPECIFIC channel of
// THIS SPECIFIC campaign — this file has no independent opinion about whether it's safe
// to run, it trusts the caller's gate and focuses entirely on doing the deploy correctly
// and safely once authorized: idempotent per step (checkpointed to DB immediately after
// each success, so a retried call resumes rather than duplicates), and every object is
// created PAUSED regardless (enforced by AdChannelAdInput.status's literal type and by
// every provider's own create-call body — see providers/meta/client.ts,
// providers/tiktok/client.ts). A failing step pauses everything already created in this
// attempt (redundant given they're already PAUSED, but keeps the bookkeeping and the
// channel's own state in agreement) and marks the channel link 'failed' rather than
// leaving it in an ambiguous half-deployed state.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '../channels/registry'
import { getConnectedAccessToken } from '../channels/access-token'
import { writeQadsAuditLog } from '../audit'
import type { ChannelDeployPayload } from './types'
import type { AdChannelAdInput } from '../channels/types'

export interface ExecuteDeployResult {
  ok: boolean
  error?: string
  externalCampaignId?: string
}

export async function executeLiveDeploy(campaignId: string, userId: string, payload: ChannelDeployPayload): Promise<ExecuteDeployResult> {
  if (process.env.QADS_LIVE_DEPLOY !== 'true') {
    // Belt-and-braces: even if this function is ever called from somewhere that forgot
    // to check the flag, it refuses to run. This is not the only gate (the deploy route
    // checks first too) — it's a second, independent one, same "no single point of
    // failure for a real-money action" posture as the credit ledger's atomic
    // debit/refund.
    return { ok: false, error: 'QADS_LIVE_DEPLOY is not enabled — refusing to execute a live deploy' }
  }

  const { data: linkRow } = await supabaseAdmin
    .from('qads_campaign_channel_links')
    .select('id, ad_account_id, external_campaign_id')
    .eq('campaign_id', campaignId)
    .eq('channel', payload.channel)
    .maybeSingle()
  if (!linkRow) return { ok: false, error: 'No channel link row found — build+save the dry-run payload first' }

  const tokenResult = await getConnectedAccessToken(payload.adAccountRowId)
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error }
  const { accessToken } = tokenResult

  const adChannel = createAdChannel(payload.channel)
  const createdThisRun: Array<{ level: 'campaign' | 'ad_set' | 'ad'; externalId: string }> = []

  try {
    // Step 1: campaign — idempotent via the already-checkpointed external_campaign_id
    // (resuming a retried deploy reuses it instead of creating a duplicate).
    let externalCampaignId = linkRow.external_campaign_id
    if (!externalCampaignId) {
      const idempotencyKey = `qads_campaign:${campaignId}:${payload.channel}`
      const result = await adChannel.createCampaign(accessToken, payload.campaignInput, idempotencyKey)
      externalCampaignId = result.externalId
      createdThisRun.push({ level: 'campaign', externalId: externalCampaignId })
      await supabaseAdmin
        .from('qads_campaign_channel_links')
        .update({ external_campaign_id: externalCampaignId, external_status: result.status, dry_run: false, deployed_at: new Date().toISOString() })
        .eq('id', linkRow.id)
      await writeQadsAuditLog({ userId, campaignId, action: 'deploy', entityType: 'campaign', entityId: externalCampaignId, afterJson: { channel: payload.channel, status: result.status } })
    }

    // Step 2..N: ad sets, each with their ads (creative upload -> creative -> ad).
    for (const adSetPayload of payload.adSets) {
      const { data: adSetRow } = await supabaseAdmin
        .from('qads_ad_sets')
        .select('external_id')
        .eq('id', adSetPayload.adSetId)
        .maybeSingle()

      let externalAdSetId = adSetRow?.external_id ?? null
      if (!externalAdSetId) {
        const idempotencyKey = `qads_ad_set:${adSetPayload.adSetId}`
        const input = { ...adSetPayload.input, campaignExternalId: externalCampaignId }
        const result = await adChannel.createAdSet(accessToken, input, idempotencyKey)
        externalAdSetId = result.externalId
        createdThisRun.push({ level: 'ad_set', externalId: externalAdSetId })
        await supabaseAdmin
          .from('qads_ad_sets')
          .update({ external_id: externalAdSetId, external_status: result.status, status: 'deployed_paused' })
          .eq('id', adSetPayload.adSetId)
      }

      for (const adPayload of adSetPayload.ads) {
        const { data: adRow } = await supabaseAdmin
          .from('qads_ads')
          .select('external_id')
          .eq('id', adPayload.adId)
          .maybeSingle()
        if (adRow?.external_id) continue // already deployed in a prior attempt — idempotent skip

        const upload = await adChannel.uploadCreativeAsset(
          accessToken,
          payload.adAccountExternalId,
          adPayload.creativeInput.assetUrl,
          adPayload.creativeInput.assetType,
        )
        const creative = await adChannel.createAdCreative(accessToken, adPayload.creativeInput, upload.externalMediaId)

        const adInput: AdChannelAdInput = { ...adPayload.adInput, adSetExternalId: externalAdSetId, creativeExternalId: creative.externalId }
        const idempotencyKey = `qads_ad:${adPayload.adId}`
        const result = await adChannel.createAd(accessToken, adInput, idempotencyKey)
        createdThisRun.push({ level: 'ad', externalId: result.externalId })
        await supabaseAdmin
          .from('qads_ads')
          .update({ external_id: result.externalId, external_status: result.status })
          .eq('id', adPayload.adId)
      }
    }

    await supabaseAdmin.from('qads_campaigns').update({ status: 'deployed_paused', updated_at: new Date().toISOString() }).eq('id', campaignId)
    return { ok: true, externalCampaignId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qads/execute-deploy] campaign ${campaignId} channel ${payload.channel} failed:`, message)

    // Rollback pass: everything created this run is already PAUSED (hard rule, enforced
    // at every create call), so "pause" is a no-op confirmation rather than a real state
    // change — but we still call it, both to catch the rare case a channel defaulted
    // something to an unexpected state, and to leave an audit trail of the rollback
    // attempt itself.
    for (const created of createdThisRun) {
      try {
        await adChannel.setStatus(accessToken, payload.adAccountExternalId, created.level, created.externalId, 'PAUSED')
      } catch (rollbackErr) {
        console.error(`[qads/execute-deploy] rollback pause failed for ${created.level} ${created.externalId}:`, rollbackErr)
      }
    }

    await supabaseAdmin
      .from('qads_campaign_channel_links')
      .update({ external_status: 'deploy_failed' })
      .eq('id', linkRow.id)
    await writeQadsAuditLog({ userId, campaignId, action: 'deploy', entityType: 'channel', entityId: payload.channel, afterJson: { error: message, createdThisRun } })

    return { ok: false, error: message }
  }
}
