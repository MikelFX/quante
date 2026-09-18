// slug -> channel factory registry. Mirrors lib/fulfillment/registry.ts and
// lib/qads/media/registry.ts exactly.

import type { AdChannel, AdChannelSlug } from './types'
import { createMetaChannel } from './providers/meta'
import { createTiktokChannel } from './providers/tiktok'

const FACTORIES: { [S in AdChannelSlug]: () => AdChannel } = {
  meta: createMetaChannel,
  tiktok: createTiktokChannel,
}

export function createAdChannel(slug: AdChannelSlug): AdChannel {
  const factory = FACTORIES[slug]
  if (!factory) throw new Error(`Unknown ad channel: ${slug}`)
  return factory()
}

export const AD_CHANNEL_SLUGS: AdChannelSlug[] = Object.keys(FACTORIES) as AdChannelSlug[]
