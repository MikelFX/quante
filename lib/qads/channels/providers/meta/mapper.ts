// Maps Qads's provider-agnostic AdChannel domain types to Meta's Graph API shapes and
// back. All Meta-specific field names/enum values are isolated here, per
// lib/qads/channels/types.ts's header comment.

import {
  createMetaCampaign,
  createMetaAdSet,
  uploadMetaImage,
  uploadMetaVideo,
  createMetaAdCreative,
  createMetaAd,
  setMetaObjectStatus,
  updateMetaAdSetBudget,
  getMetaInsights,
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
  const result = await createMetaCampaign(accessToken, input.adAccountExternalId, {
    name: input.name,
    objective: input.objective,
    dailyBudgetMinor: input.dailyBudgetMinor,
    lifetimeBudgetMinor: input.lifetimeBudgetMinor,
  })
  return { externalId: result.id, status: result.status ?? 'PAUSED' }
}

export async function createAdSetViaMapper(accessToken: string, input: AdChannelAdSetInput) {
  // Targeting field names (geo_locations.countries, age_min/age_max, genders,
  // flexible_spec for interests) match Meta's documented targeting spec shape — exact
  // interest-id resolution (Meta targets interests by internal id, not free text) is an
  // open item: this passes interest labels through as-is, which will need a real
  // interest-search API call (act_<id>/targetingsearch) wired in before live use.
  const targeting: Record<string, unknown> = {
    age_min: input.audience.ageMin,
    age_max: input.audience.ageMax,
    genders: input.audience.genders,
    geo_locations: input.audience.geoCountries ? { countries: input.audience.geoCountries } : undefined,
    flexible_spec: input.audience.interests?.length ? [{ interests: input.audience.interests.map((name) => ({ name })) }] : undefined,
  }

  const result = await createMetaAdSet(accessToken, input.adAccountExternalId, {
    name: input.name,
    campaignId: input.campaignExternalId,
    dailyBudgetMinor: input.dailyBudgetMinor,
    lifetimeBudgetMinor: input.lifetimeBudgetMinor,
    billingEvent: input.billingEvent,
    optimizationGoal: input.bidStrategy,
    targeting,
  })
  return { externalId: result.id, status: result.status ?? 'PAUSED' }
}

export async function uploadCreativeAssetViaMapper(accessToken: string, adAccountExternalId: string, assetUrl: string, assetType: 'image' | 'video') {
  if (assetType === 'video') {
    const video = await uploadMetaVideo(accessToken, adAccountExternalId, assetUrl)
    return { externalMediaId: video.id }
  }
  const image = await uploadMetaImage(accessToken, adAccountExternalId, assetUrl)
  return { externalMediaId: image.hash }
}

export async function createAdCreativeViaMapper(accessToken: string, input: AdChannelCreativeInput, externalMediaId: string) {
  // page_id isn't part of AdChannelCreativeInput today — it lives on qads_ad_accounts
  // (page_id column, set at connection time). The deploy layer (step f) is expected to
  // pass it through; documented here as a known gap rather than silently assumed.
  const pageId = (input as unknown as { pageId?: string }).pageId
  if (!pageId) throw new Error('Meta ad creative requires a connected Page id (qads_ad_accounts.page_id) — none provided')

  const result = await createMetaAdCreative(accessToken, input.adAccountExternalId, {
    pageId,
    imageHash: input.assetType === 'image' ? externalMediaId : undefined,
    videoId: input.assetType === 'video' ? externalMediaId : undefined,
    message: `${input.texts.headline}\n\n${input.texts.primaryText}`,
    link: input.linkUrl,
    cta: input.texts.cta,
  })
  return { externalId: result.id }
}

export async function createAdViaMapper(accessToken: string, input: AdChannelAdInput) {
  const result = await createMetaAd(accessToken, input.adAccountExternalId, {
    name: input.name,
    adSetId: input.adSetExternalId,
    creativeId: input.creativeExternalId,
  })
  return { externalId: result.id, status: result.status ?? 'PAUSED' }
}

export async function setStatusViaMapper(accessToken: string, _adAccountExternalId: string, externalId: string, status: 'ACTIVE' | 'PAUSED') {
  // Meta addresses objects directly by id (POST /{object_id}) — no ad-account prefix
  // needed, unlike TikTok. Accepted for interface parity, unused here.
  void _adAccountExternalId
  await setMetaObjectStatus(accessToken, externalId, status)
}

export async function updateBudgetViaMapper(accessToken: string, _adAccountExternalId: string, adSetExternalId: string, budgetMinor: number, budgetType: 'daily' | 'lifetime') {
  void _adAccountExternalId
  await updateMetaAdSetBudget(accessToken, adSetExternalId, budgetMinor, budgetType)
}

export async function getInsightsViaMapper(accessToken: string, query: AdChannelInsightsQuery): Promise<AdChannelInsightsRow[]> {
  const rows = await getMetaInsights(accessToken, query.entityExternalId, query.since, query.until)
  return rows.map((r) => {
    const purchaseAction = r.actions?.find((a) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase')
    return {
      day: r.date_start,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      spendMinor: Math.round(Number(r.spend ?? 0) * 100),
      conversions: purchaseAction ? Number(purchaseAction.value) : undefined,
    }
  })
}
