import type { MediaProvider } from '../../types'
import type { HiggsfieldCredentials } from './client'
import { submitViaMapper, getStatusViaMapper, cancelViaMapper, parseHiggsfieldWebhook } from './mapper'

export type { HiggsfieldCredentials }

// Preset for Marketing Studio's enhanced mode — a human needs to browse
// GET /marketing-studio/image/presets in the Higgsfield Console to pick sensible
// defaults per campaign goal/voice (docs/qads-proposal.md §9 open question). Until then,
// every request uses Direct Edit mode (see mapper.ts), which needs no preset at all.
const DEFAULT_PRESET_ID = process.env.HIGGSFIELD_MARKETING_STUDIO_PRESET_ID || undefined

export function createHiggsfieldProvider(creds: HiggsfieldCredentials): MediaProvider {
  return {
    slug: 'higgsfield',
    submit: (input) => submitViaMapper(creds, input, DEFAULT_PRESET_ID),
    getStatus: (statusUrl) => getStatusViaMapper(creds, statusUrl),
    cancel: (cancelUrl) => cancelViaMapper(creds, cancelUrl),
    parseWebhookPayload: parseHiggsfieldWebhook,
  }
}

export function getHiggsfieldCredentialsFromEnv(): HiggsfieldCredentials | null {
  const keyId = process.env.HIGGSFIELD_API_KEY_ID
  const keySecret = process.env.HIGGSFIELD_API_KEY_SECRET
  if (!keyId || !keySecret) return null
  return { keyId, keySecret }
}
