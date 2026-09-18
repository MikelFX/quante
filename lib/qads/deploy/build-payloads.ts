// buildDeployPayloads — the pure "would-send" builder from docs/qads-proposal.md §5.1.
// Reads the campaign's angles/ad-sets/ads/creatives and the project's connected ad
// accounts, and turns them into channel-ready AdChannel* input objects, running each
// channel's validateBeforeSend() along the way. Does NOT call any channel API — no
// network I/O to Meta/TikTok happens in this file. The caller (the deploy route) is
// responsible for persisting the result as a dry-run snapshot and, separately and only
// under QADS_LIVE_DEPLOY + explicit per-channel confirmation, executing it for real
// (see execute-deploy.ts).

import { supabaseAdmin } from '@/lib/supabase/admin'
import { createAdChannel } from '../channels/registry'
import { objectiveForGoal } from './objective-map'
import { resolveStoreUrl } from './store-url'
import type { QadsChannel, CampaignGoal } from '../types'
import type { ChannelDeployPayload, DeployAdSetPayload, DeployAdPayload, BuildDeployPayloadsResult } from './types'
import type { AdChannelCreativeInput } from '../channels/types'

interface AdSetRow {
  id: string
  channel: QadsChannel
  name: string
  audience: { ageMin?: number; ageMax?: number; genders?: string[]; geo?: string[]; interests?: string[]; lookalikeSourceRef?: string; customAudienceRef?: string }
  placements: string[]
  budget_minor: number
  budget_type: 'daily' | 'lifetime'
  bid_strategy: string | null
  schedule_start: string | null
  schedule_end: string | null
}

interface AdRow {
  id: string
  ad_set_id: string
  format: '1:1' | '4:5' | '9:16' | '16:9'
  texts: { headline: string; primaryText: string; description?: string; cta: string }
  creative_id: string | null
  approval_status: string
}

interface CreativeRow {
  id: string
  type: 'static' | 'video'
  status: string
  asset_id: string | null
}

interface AssetRow {
  id: string
  storage_path: string
}

export async function buildDeployPayloads(campaignId: string): Promise<BuildDeployPayloadsResult> {
  const empty: BuildDeployPayloadsResult = {
    ok: false,
    payloadsByChannel: {},
    validationErrors: {},
    skipped: { adsWithoutCreative: [], adSetsWithoutAds: [], channelsWithoutAdAccount: [] },
  }

  const { data: campaign } = await supabaseAdmin
    .from('qads_campaigns')
    .select('id, project_id, goal, channels, currency')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { ...empty, error: 'Campaign not found' }

  const channels = (campaign.channels ?? []) as QadsChannel[]
  const goal = campaign.goal as CampaignGoal

  const [{ data: adAccounts }, { data: adSets }] = await Promise.all([
    supabaseAdmin
      .from('qads_ad_accounts')
      .select('id, channel, external_account_id, status')
      .eq('project_id', campaign.project_id)
      .in('channel', channels),
    supabaseAdmin
      .from('qads_ad_sets')
      .select('id, channel, name, audience, placements, budget_minor, budget_type, bid_strategy, schedule_start, schedule_end')
      .eq('campaign_id', campaignId) as unknown as Promise<{ data: AdSetRow[] | null }>,
  ])

  const adAccountByChannel = new Map((adAccounts ?? []).filter((a) => a.status === 'connected').map((a) => [a.channel as QadsChannel, a]))
  const channelsWithoutAdAccount = channels.filter((c) => !adAccountByChannel.has(c))

  const adSetRows = (adSets ?? []) as AdSetRow[]
  const adSetIds = adSetRows.map((s) => s.id)
  if (!adSetIds.length) return { ...empty, error: 'Campaign has no ad sets to deploy' }

  const { data: adsData } = await supabaseAdmin
    .from('qads_ads')
    .select('id, ad_set_id, format, texts, creative_id, approval_status')
    .in('ad_set_id', adSetIds)
  const adRows = (adsData ?? []) as AdRow[]

  const creativeIds = adRows.map((a) => a.creative_id).filter((id): id is string => !!id)
  const { data: creativesData } = creativeIds.length
    ? await supabaseAdmin.from('qads_creatives').select('id, type, status, asset_id').in('id', creativeIds)
    : { data: [] }
  const creativeById = new Map(((creativesData ?? []) as CreativeRow[]).map((c) => [c.id, c]))

  const assetIds = [...creativeById.values()].map((c) => c.asset_id).filter((id): id is string => !!id)
  const { data: assetsData } = assetIds.length
    ? await supabaseAdmin.from('qads_assets').select('id, storage_path').in('id', assetIds)
    : { data: [] }
  const assetById = new Map(((assetsData ?? []) as AssetRow[]).map((a) => [a.id, a]))

  const landingUrl = await resolveStoreUrl(campaign.project_id)

  const adsWithoutCreative: string[] = []
  const adSetsWithoutAds: string[] = []
  const payloadsByChannel: Record<string, ChannelDeployPayload> = {}
  const validationErrors: Record<string, string[]> = {}

  for (const channel of channels) {
    const adAccount = adAccountByChannel.get(channel)
    if (!adAccount) continue // already recorded in channelsWithoutAdAccount

    const channelAdSets = adSetRows.filter((s) => s.channel === channel)
    if (!channelAdSets.length) continue

    const adChannel = createAdChannel(channel)
    const errorsForChannel: string[] = []
    const deploySets: DeployAdSetPayload[] = []

    for (const adSet of channelAdSets) {
      const setAds = adRows.filter((a) => a.ad_set_id === adSet.id)
      const deployAds: DeployAdPayload[] = []

      for (const ad of setAds) {
        const creative = ad.creative_id ? creativeById.get(ad.creative_id) : undefined
        const asset = creative?.asset_id ? assetById.get(creative.asset_id) : undefined
        if (!creative || creative.status !== 'completed' || !asset) {
          // Leaf-node skip, not a campaign-wide failure — matches the same "one failed
          // asset doesn't sink the campaign" principle used throughout the pipeline
          // (docs/qads-proposal.md §3.2, already applied in pipeline/runner.ts).
          adsWithoutCreative.push(ad.id)
          continue
        }

        const { data: urlData } = supabaseAdmin.storage.from('qads-assets').getPublicUrl(asset.storage_path)
        if (!landingUrl) {
          errorsForChannel.push(`No live store URL found for project ${campaign.project_id} — deploy the store before deploying ads`)
          continue
        }

        const creativeInput: AdChannelCreativeInput = {
          adAccountExternalId: adAccount.external_account_id,
          assetUrl: urlData.publicUrl,
          assetType: creative.type === 'video' ? 'video' : 'image',
          texts: ad.texts,
          linkUrl: landingUrl,
        }

        deployAds.push({
          adId: ad.id,
          creativeInput,
          adInput: {
            adAccountExternalId: adAccount.external_account_id,
            adSetExternalId: '', // filled in once createAdSet returns, at execute time
            name: `${adSet.name} — ${ad.format}`,
            status: 'PAUSED',
          },
        })
      }

      if (!deployAds.length) {
        adSetsWithoutAds.push(adSet.id)
        continue
      }

      const adSetInput = {
        adAccountExternalId: adAccount.external_account_id,
        campaignExternalId: '', // filled in once createCampaign returns, at execute time
        name: adSet.name,
        audience: {
          ageMin: adSet.audience.ageMin,
          ageMax: adSet.audience.ageMax,
          genders: adSet.audience.genders,
          geoCountries: adSet.audience.geo, // DB field is `geo` (matches the strategy schema), interface field is `geoCountries`
          interests: adSet.audience.interests,
          lookalikeSourceRef: adSet.audience.lookalikeSourceRef,
          customAudienceRef: adSet.audience.customAudienceRef,
        },
        placements: adSet.placements,
        dailyBudgetMinor: adSet.budget_type === 'daily' ? adSet.budget_minor : undefined,
        lifetimeBudgetMinor: adSet.budget_type === 'lifetime' ? adSet.budget_minor : undefined,
        billingEvent: undefined,
        bidStrategy: adSet.bid_strategy ?? undefined,
        startTime: adSet.schedule_start ?? undefined,
        endTime: adSet.schedule_end ?? undefined,
      }

      const validation = await adChannel.validateBeforeSend(adSetInput)
      if (!validation.ok) errorsForChannel.push(...validation.errors.map((e) => `ad set "${adSet.name}": ${e}`))

      deploySets.push({ adSetId: adSet.id, input: adSetInput, ads: deployAds })
    }

    if (!deploySets.length) continue

    const campaignInput = {
      adAccountExternalId: adAccount.external_account_id,
      name: `Qads campaign ${campaignId}`, // step (j) UI can let the merchant rename before deploy; qads_campaigns.name is the internal/brief name, not necessarily channel-appropriate
      objective: objectiveForGoal(channel, goal),
      dailyBudgetMinor: undefined,
      lifetimeBudgetMinor: undefined,
    }
    const campaignValidation = await adChannel.validateBeforeSend(campaignInput)
    if (!campaignValidation.ok) errorsForChannel.push(...campaignValidation.errors.map((e) => `campaign: ${e}`))

    if (errorsForChannel.length) validationErrors[channel] = errorsForChannel

    payloadsByChannel[channel] = {
      channel,
      adAccountRowId: adAccount.id,
      adAccountExternalId: adAccount.external_account_id,
      campaignInput,
      adSets: deploySets,
    }
  }

  const hasAnyPayload = Object.keys(payloadsByChannel).length > 0
  const hasAnyErrors = Object.keys(validationErrors).length > 0

  return {
    ok: hasAnyPayload && !hasAnyErrors,
    error: !hasAnyPayload ? 'No channel had a complete, ready-to-deploy set of ad sets + ads + creatives' : undefined,
    payloadsByChannel,
    validationErrors,
    skipped: { adsWithoutCreative, adSetsWithoutAds, channelsWithoutAdAccount },
  }
}
