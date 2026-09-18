// Maps Qads's provider-agnostic AdChannel domain types to TikTok's Business API shapes.
// Mirrors ../meta/mapper.ts exactly in structure — all TikTok-specific field
// names/enum values are isolated here, per ../../types.ts's header comment. TikTok's
// "ad group" is this codebase's shared 'ad_set' level (see types.ts note).

import {
  createTiktokCampaign,
  createTiktokAdGroup,
  uploadTiktokImage,
  uploadTiktokVideo,
  createTiktokAd,
  setTiktokObjectStatus,
  updateTiktokAdGroupBudget,
  getTiktokInsights,
} from './client'
import type {
  AdChannelCampaignInput,
  AdChannelAdSetInput,
  AdChannelCreativeInput,
  AdChannelAdInput,
  AdChannelInsightsQuery,
  AdChannelInsightsRow,
} from '../../types'

export async function createCampaignViaMapper(accessToken: string, input: AdChannelCampaignInput) {
  const result = await createTiktokCampaign(accessToken, input.adAccountExternalId, {
    name: input.name,
    objective: input.objective,
    dailyBudgetMinor: input.dailyBudgetMinor,
    lifetimeBudgetMinor: input.lifetimeBudgetMinor,
  })
  return { externalId: result.id, status: result.status }
}

export async function createAdSetViaMapper(accessToken: string, input: AdChannelAdSetInput) {
  // TikTok's targeting field names (location_ids, age_groups, gender, interest_category_ids)
  // differ from Meta's — location/interest resolution needs TikTok's own id-lookup
  // endpoints (tool/region/, tool/interest_category/), not free-text names. Same
  // documented open item as Meta's interest-id resolution in ../meta/mapper.ts: this
  // passes labels through as a best-effort placeholder, flagged for the deploy layer
  // (step f) to replace with real id lookups before live use.
  const targeting: Record<string, unknown> = {
    age_groups: ageRangeToTiktokGroups(input.audience.ageMin, input.audience.ageMax),
    gender: genderToTiktokGender(input.audience.genders),
    location_ids: input.audience.geoCountries,
    interest_category_ids: input.audience.interests,
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
  }

  const result = await createTiktokAdGroup(accessToken, input.adAccountExternalId, {
    name: input.name,
    campaignId: input.campaignExternalId,
    dailyBudgetMinor: input.dailyBudgetMinor,
    lifetimeBudgetMinor: input.lifetimeBudgetMinor,
    billingEvent: input.billingEvent,
    optimizationGoal: input.bidStrategy,
    targeting,
  })
  return { externalId: result.id, status: result.status }
}

export async function uploadCreativeAssetViaMapper(accessToken: string, adAccountExternalId: string, assetUrl: string, assetType: 'image' | 'video') {
  if (assetType === 'video') {
    const video = await uploadTiktokVideo(accessToken, adAccountExternalId, assetUrl)
    return { externalMediaId: video.videoId }
  }
  const image = await uploadTiktokImage(accessToken, adAccountExternalId, assetUrl)
  return { externalMediaId: image.imageId }
}

// TikTok combines creative + ad into a single ad/create/ call (see client.ts comment),
// so unlike Meta there's no separate "create the creative object, get its id back"
// step — this mapper function exists to satisfy the shared AdChannel.createAdCreative
// contract, but just validates/passes the input through; the actual TikTok API call
// happens in createAdViaMapper below, which needs both the creative input AND the ad
// input together. The externalId returned here is a synthetic placeholder (not a real
// TikTok object id) — createAdViaMapper is where the real ad_ids[0] comes back.
export async function createAdCreativeViaMapper(_accessToken: string, input: AdChannelCreativeInput, externalMediaId: string) {
  void _accessToken
  return { externalId: `pending:${externalMediaId}:${input.assetType}` }
}

export async function createAdViaMapper(
  accessToken: string,
  input: AdChannelAdInput,
  creativeInput: AdChannelCreativeInput,
  externalMediaId: string,
) {
  // identity_id (a connected TikTok account / Custom Identity, required by TikTok's
  // ad/create/) isn't part of AdChannelCreativeInput today — same documented gap as
  // Meta's pageId requirement (see ../meta/mapper.ts's createAdCreativeViaMapper
  // comment). Read via the same unsafe-cast pattern so the deploy layer (step f) can
  // supply it once qads_ad_accounts carries a TikTok identity id column.
  const identityId = (creativeInput as unknown as { identityId?: string }).identityId
  const result = await createTiktokAd(accessToken, input.adAccountExternalId, {
    adgroupId: input.adSetExternalId,
    name: input.name,
    imageId: creativeInput.assetType === 'image' ? externalMediaId : undefined,
    videoId: creativeInput.assetType === 'video' ? externalMediaId : undefined,
    identityId,
    text: `${creativeInput.texts.headline} ${creativeInput.texts.primaryText}`.trim(),
    landingPageUrl: creativeInput.linkUrl,
    cta: creativeInput.texts.cta,
  })
  return { externalId: result.id, status: result.status }
}

export async function setStatusViaMapper(
  accessToken: string,
  adAccountExternalId: string,
  level: 'campaign' | 'ad_set' | 'ad',
  externalId: string,
  status: 'ACTIVE' | 'PAUSED',
) {
  const tiktokLevel = level === 'ad_set' ? 'adgroup' : level
  await setTiktokObjectStatus(accessToken, adAccountExternalId, tiktokLevel, externalId, status === 'ACTIVE' ? 'ENABLE' : 'DISABLE')
}

export async function updateBudgetViaMapper(
  accessToken: string,
  adAccountExternalId: string,
  adSetExternalId: string,
  budgetMinor: number,
  budgetType: 'daily' | 'lifetime',
) {
  await updateTiktokAdGroupBudget(accessToken, adAccountExternalId, adSetExternalId, budgetMinor, budgetType)
}

export async function getInsightsViaMapper(accessToken: string, query: AdChannelInsightsQuery): Promise<AdChannelInsightsRow[]> {
  const rows = await getTiktokInsights(accessToken, query.adAccountExternalId, query.level, query.entityExternalId, query.since, query.until)
  return rows.map((r) => ({
    day: r.dimensions.stat_time_day,
    impressions: Number(r.metrics.impressions ?? 0),
    clicks: Number(r.metrics.clicks ?? 0),
    spendMinor: Math.round(Number(r.metrics.spend ?? 0) * 100),
    conversions: r.metrics.conversion ? Number(r.metrics.conversion) : undefined,
  }))
}

function ageRangeToTiktokGroups(ageMin?: number, ageMax?: number): string[] | undefined {
  if (!ageMin && !ageMax) return undefined
  // TikTok targets discrete age-group buckets (AGE_13_17, AGE_18_24, AGE_25_34,
  // AGE_35_44, AGE_45_54, AGE_55_100...), not a continuous min/max range like Meta —
  // best-effort bucket mapping, flagged as an open item to verify against TikTok's
  // current live enum before live use.
  const buckets: Array<[number, number, string]> = [
    [13, 17, 'AGE_13_17'], [18, 24, 'AGE_18_24'], [25, 34, 'AGE_25_34'],
    [35, 44, 'AGE_35_44'], [45, 54, 'AGE_45_54'], [55, 100, 'AGE_55_100'],
  ]
  const lo = ageMin ?? 13
  const hi = ageMax ?? 100
  return buckets.filter(([bLo, bHi]) => bHi >= lo && bLo <= hi).map(([, , name]) => name)
}

function genderToTiktokGender(genders?: string[]): string {
  if (!genders?.length || genders.length > 1) return 'GENDER_UNLIMITED'
  const g = genders[0].toLowerCase()
  if (g === 'male' || g === 'men') return 'GENDER_MALE'
  if (g === 'female' || g === 'women') return 'GENDER_FEMALE'
  return 'GENDER_UNLIMITED'
}
