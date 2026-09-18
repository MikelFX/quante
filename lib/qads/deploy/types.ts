// Deploy-layer domain types. A ChannelDeployPayload is the full, channel-ready shape of
// "what would be sent" for one channel of one campaign — this is both the dry-run
// approval-screen payload (docs/qads-proposal.md §5.1) and the exact input the live
// path executes against, so what the merchant approves is provably what gets sent.

import type {
  AdChannelCampaignInput,
  AdChannelAdSetInput,
  AdChannelCreativeInput,
  AdChannelAdInput,
} from '../channels/types'
import type { QadsChannel } from '../types'

export interface DeployAdPayload {
  adId: string // qads_ads.id
  creativeInput: AdChannelCreativeInput
  adInput: Omit<AdChannelAdInput, 'creativeExternalId'> // filled in once createAdCreative returns, at execute time
}

export interface DeployAdSetPayload {
  adSetId: string // qads_ad_sets.id
  input: AdChannelAdSetInput
  ads: DeployAdPayload[]
}

export interface ChannelDeployPayload {
  channel: QadsChannel
  adAccountRowId: string // qads_ad_accounts.id
  adAccountExternalId: string
  campaignInput: AdChannelCampaignInput
  adSets: DeployAdSetPayload[]
}

export interface BuildDeployPayloadsResult {
  ok: boolean
  error?: string
  payloadsByChannel: Record<string, ChannelDeployPayload>
  validationErrors: Record<string, string[]>
  skipped: {
    adsWithoutCreative: string[] // qads_ads.id
    adSetsWithoutAds: string[] // qads_ad_sets.id
    channelsWithoutAdAccount: QadsChannel[]
  }
}
