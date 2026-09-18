// Ad channel abstraction — a real external ad platform (Meta, TikTok). Mirrors
// lib/fulfillment/types.ts + registry.ts and lib/qads/media/types.ts + registry.ts:
// provider-agnostic domain types here, all Meta/TikTok-specific field names/enum values
// live in each provider's own mapper.ts.
//
// Field naming here (objective, audience/targeting shape, placements, billingEvent,
// bidStrategy, campaign -> ad set -> ad hierarchy, ad = creative + targeting-inherited-
// from-adset) mirrors Meta's Marketing API object model directly, per
// docs/qads-proposal.md §5 — TikTok's mapper translates the same domain shape into
// TikTok's own campaign -> ad_group -> ad terms (TikTok's "ad group" is what this
// interface calls an ad set).
//
// CONFIRMED vs OPEN, tracked explicitly rather than blurred together:
//   CONFIRMED (fetched from developers.facebook.com and the TikTok Business API docs
//   during this implementation step): OAuth authorize/token endpoints for both
//   channels, and the campaign -> ad set/ad group -> ad object hierarchy for both.
//   OPEN (needs a human with a live sandbox ad account to verify field-by-field, per
//   the proposal's own §9): exact objective enum strings (Meta has migrated these
//   before — OUTCOME_* replaced legacy CONVERSIONS-style values — and TikTok's
//   objective_type enum), exact targeting field names/shapes, and API version pinning
//   beyond what's used below. Every provider method that touches this is commented at
//   the call site. This is why QADS_LIVE_DEPLOY stays off regardless of app-review
//   status (docs/qads-proposal.md §5.1) — these interfaces are real and exercised in
//   dry-run, but their exact wire format is not yet verified against a live account.

export type AdChannelSlug = 'meta' | 'tiktok'

// Deliberate small addition over docs/qads-proposal.md §5's original interface sketch:
// AdChannelCampaignInput/AdChannelAdSetInput/AdChannelAdInput now carry
// adAccountExternalId (AdChannelCreativeInput already had it). Every real ad platform
// scopes campaign/ad-set/ad creation under an ad account — Meta's endpoints are literally
// POST /act_<id>/campaigns, /adsets, /ads — so a shared interface without it would force
// every provider implementation to either hide account resolution in a closure (fragile
// once a channel supports multiple ad accounts) or fail at the call site, which is what
// an earlier draft of the Meta provider actually did before this was caught and fixed.

export interface AdChannelCampaignInput {
  adAccountExternalId: string
  name: string
  objective: string // channel-native objective string — validated per channel, not coerced into one shared enum. See OPEN note above.
  dailyBudgetMinor?: number
  lifetimeBudgetMinor?: number
  startTime?: string
  endTime?: string
}

export interface AdChannelAdSetInput {
  adAccountExternalId: string
  campaignExternalId: string
  name: string
  audience: {
    ageMin?: number
    ageMax?: number
    genders?: string[]
    geoCountries?: string[]
    interests?: string[]
    lookalikeSourceRef?: string
    customAudienceRef?: string
  }
  placements: string[]
  dailyBudgetMinor?: number
  lifetimeBudgetMinor?: number
  billingEvent?: string
  bidStrategy?: string
  startTime?: string
  endTime?: string
}

export interface AdChannelCreativeInput {
  adAccountExternalId: string
  assetUrl: string // qads_assets storage URL — uploaded to the channel's media library first
  assetType: 'image' | 'video'
  texts: { headline: string; primaryText: string; description?: string; cta: string }
  linkUrl: string // deployed store URL / product page
}

export interface AdChannelAdInput {
  adAccountExternalId: string
  adSetExternalId: string
  name: string
  creativeExternalId: string
  status: 'PAUSED' // literal type — nothing else is ever passed at creation, hard rule (docs/qads-proposal.md, project CLAUDE.md §14)
}

export interface AdChannelInsightsQuery {
  adAccountExternalId: string // added alongside the campaign/ad-set/ad fix below — TikTok's reporting endpoint requires advertiser_id on every call; Meta's provider accepts and ignores it since Meta addresses insights by entity id alone
  level: 'campaign' | 'ad_set' | 'ad'
  entityExternalId: string
  since: string // ISO date
  until: string // ISO date
}

export interface AdChannelInsightsRow {
  day: string
  impressions: number
  clicks: number
  spendMinor: number
  conversions?: number
  conversionValueMinor?: number
}

export interface ChannelOAuthResult {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  externalAccountId: string
  businessId?: string
  scopes: string[]
}

export interface AdChannel {
  readonly slug: AdChannelSlug

  getOAuthUrl(state: string): string
  exchangeOAuthCode(code: string): Promise<ChannelOAuthResult>
  refreshToken(refreshToken: string): Promise<{ accessToken: string; expiresAt?: string }>
  checkPermissions(accessToken: string, adAccountId: string): Promise<{ ok: boolean; missing: string[] }>

  // Every creation call takes an idempotencyKey — passed through to the channel when it
  // supports native dedup, and ALWAYS additionally guarded DB-side by the insert-first-
  // unique-constraint pattern from lib/fulfillment/auto-ship.ts (see the deploy layer in
  // step f). Every object is created PAUSED; no implementation may pass any other
  // initial status — enforced structurally by AdChannelAdInput.status's literal type.
  createCampaign(accessToken: string, input: AdChannelCampaignInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>
  createAdSet(accessToken: string, input: AdChannelAdSetInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>
  uploadCreativeAsset(accessToken: string, adAccountExternalId: string, assetUrl: string, assetType: 'image' | 'video'): Promise<{ externalMediaId: string }>
  createAdCreative(accessToken: string, input: AdChannelCreativeInput, externalMediaId: string): Promise<{ externalId: string }>
  createAd(accessToken: string, input: AdChannelAdInput, idempotencyKey: string): Promise<{ externalId: string; status: string }>

  // adAccountExternalId added to setStatus/updateBudget for the same reason as the
  // creation methods above: TikTok's status/budget endpoints require advertiser_id on
  // every call (Meta's do not — its provider accepts and ignores the param). Caught
  // while building the TikTok provider, fixed the same way as the earlier Meta gap:
  // extend the shared interface rather than hide account resolution in a closure or
  // throw a stub.
  setStatus(accessToken: string, adAccountExternalId: string, level: 'campaign' | 'ad_set' | 'ad', externalId: string, status: 'ACTIVE' | 'PAUSED'): Promise<void>
  updateBudget(accessToken: string, adAccountExternalId: string, adSetExternalId: string, budgetMinor: number, budgetType: 'daily' | 'lifetime'): Promise<void>

  validateBeforeSend(input: AdChannelCampaignInput | AdChannelAdSetInput | AdChannelAdInput): Promise<{ ok: boolean; errors: string[] }>

  getInsights(accessToken: string, query: AdChannelInsightsQuery): Promise<AdChannelInsightsRow[]>
}
