import type { AdChannel, AdChannelCreativeInput } from '../../types'
import { getTiktokOAuthUrl, exchangeTiktokOAuthCode, refreshTiktokToken, checkTiktokPermissions } from './oauth'
import {
  createCampaignViaMapper,
  createAdSetViaMapper,
  uploadCreativeAssetViaMapper,
  createAdCreativeViaMapper,
  createAdViaMapper,
  setStatusViaMapper,
  updateBudgetViaMapper,
  getInsightsViaMapper,
} from './mapper'

// TikTok's ad/create/ combines creative + ad into a single API call (see client.ts's
// createTiktokAd comment), but the shared AdChannel interface (types.ts) — modeled on
// Meta's two-step creatives -> ads flow — calls createAdCreative and createAd
// separately, from a graph runner (lib/qads/pipeline/graph.ts's deploy-layer
// counterpart, step f) that doesn't know TikTok merges them. Rather than force a
// TikTok-specific runner branch, this factory bridges the two calls: createAdCreative
// stashes the creative input in memory keyed by a synthetic externalId, and createAd
// looks it up and fires the real TikTok API call. This is a per-channel-instance cache,
// not a DB table — safe because a single deploy-layer run creates a creative and its ad
// back-to-back (never across a process restart); the real, durable id after this point
// is qads_creatives.external_creative_id set once createAd returns, matching the
// idempotent insert-first pattern used elsewhere (lib/fulfillment/auto-ship.ts).
export function createTiktokChannel(): AdChannel {
  const pendingCreatives = new Map<string, AdChannelCreativeInput>()

  return {
    slug: 'tiktok',

    getOAuthUrl: getTiktokOAuthUrl,
    exchangeOAuthCode: async (code) => {
      const result = await exchangeTiktokOAuthCode(code)
      return { accessToken: result.accessToken, externalAccountId: result.externalAccountId, scopes: result.scopes }
    },
    refreshToken: refreshTiktokToken,
    checkPermissions: async (accessToken, adAccountId) => checkTiktokPermissions(accessToken, adAccountId),

    createCampaign: async (accessToken, input, _idempotencyKey) => {
      // TikTok's create endpoints don't take a client-supplied idempotency key either —
      // same posture as Meta, dedup relies on the DB-side unique-constraint pattern one
      // layer up (step f).
      void _idempotencyKey
      return createCampaignViaMapper(accessToken, input)
    },
    createAdSet: async (accessToken, input, _idempotencyKey) => {
      void _idempotencyKey
      return createAdSetViaMapper(accessToken, input)
    },
    uploadCreativeAsset: async (accessToken, adAccountExternalId, assetUrl, assetType) =>
      uploadCreativeAssetViaMapper(accessToken, adAccountExternalId, assetUrl, assetType),
    createAdCreative: async (accessToken, input, externalMediaId) => {
      const result = await createAdCreativeViaMapper(accessToken, input, externalMediaId)
      pendingCreatives.set(result.externalId, input)
      return result
    },
    createAd: async (accessToken, input, _idempotencyKey) => {
      void _idempotencyKey
      const creativeInput = pendingCreatives.get(input.creativeExternalId)
      if (!creativeInput) {
        throw new Error(
          `TikTok createAd: no pending creative found for creativeExternalId=${input.creativeExternalId}. ` +
          'TikTok merges creative+ad into one call — createAdCreative must be invoked first, in the same ' +
          'process, immediately before createAd (see this file\'s header comment).',
        )
      }
      // Need the externalMediaId that was passed to createAdCreative — it's embedded in
      // the synthetic externalId format ("pending:<mediaId>:<assetType>") produced by
      // createAdCreativeViaMapper.
      const mediaId = input.creativeExternalId.split(':')[1]
      const result = await createAdViaMapper(accessToken, input, creativeInput, mediaId)
      pendingCreatives.delete(input.creativeExternalId)
      return result
    },

    setStatus: async (accessToken, adAccountExternalId, level, externalId, status) =>
      setStatusViaMapper(accessToken, adAccountExternalId, level, externalId, status),
    updateBudget: async (accessToken, adAccountExternalId, adSetExternalId, budgetMinor, budgetType) =>
      updateBudgetViaMapper(accessToken, adAccountExternalId, adSetExternalId, budgetMinor, budgetType),

    validateBeforeSend: async (input) => {
      const errors: string[] = []
      if ('objective' in input && !input.objective) errors.push('objective is required')
      if ('name' in input && !input.name?.trim()) errors.push('name is required')
      if ('status' in input && input.status !== 'PAUSED') errors.push("status must be 'PAUSED' — hard rule, never anything else at creation")
      return { ok: errors.length === 0, errors }
    },

    getInsights: async (accessToken, query) => getInsightsViaMapper(accessToken, query),
  }
}
