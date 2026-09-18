import type { AdChannel } from '../../types'
import { getMetaOAuthUrl, exchangeMetaOAuthCode, refreshMetaToken, checkMetaPermissions } from './oauth'
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

// adAccountExternalId now lives directly on AdChannelCampaignInput/AdChannelAdSetInput/
// AdChannelAdInput (types.ts) and as an explicit uploadCreativeAsset parameter — the
// interface gap flagged in an earlier draft of this file (throwing stub helpers guessing
// at ad-account resolution) is fixed at the type level instead, so every method below is a
// real implementation, not a placeholder.

export function createMetaChannel(): AdChannel {
  return {
    slug: 'meta',

    getOAuthUrl: getMetaOAuthUrl,
    exchangeOAuthCode: async (code) => {
      const result = await exchangeMetaOAuthCode(code)
      return result
    },
    refreshToken: refreshMetaToken,
    checkPermissions: async (accessToken) => checkMetaPermissions(accessToken),

    createCampaign: async (accessToken, input, _idempotencyKey) => {
      // Meta has no native idempotency-key parameter for campaign creation — dedup relies
      // entirely on the DB-side unique-constraint pattern one layer up (step f), matching
      // lib/fulfillment/auto-ship.ts's "insert-first, DB unique constraint is the real
      // guard" approach. _idempotencyKey is accepted (interface contract) but unused here.
      void _idempotencyKey
      return createCampaignViaMapper(accessToken, input)
    },
    createAdSet: async (accessToken, input, _idempotencyKey) => {
      void _idempotencyKey
      return createAdSetViaMapper(accessToken, input)
    },
    uploadCreativeAsset: async (accessToken, adAccountExternalId, assetUrl, assetType) =>
      uploadCreativeAssetViaMapper(accessToken, adAccountExternalId, assetUrl, assetType),
    createAdCreative: async (accessToken, input, externalMediaId) => createAdCreativeViaMapper(accessToken, input, externalMediaId),
    createAd: async (accessToken, input, _idempotencyKey) => {
      void _idempotencyKey
      return createAdViaMapper(accessToken, input)
    },

    setStatus: async (accessToken, adAccountExternalId, _level, externalId, status) => setStatusViaMapper(accessToken, adAccountExternalId, externalId, status),
    updateBudget: async (accessToken, adAccountExternalId, adSetExternalId, budgetMinor, budgetType) => updateBudgetViaMapper(accessToken, adAccountExternalId, adSetExternalId, budgetMinor, budgetType),

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
