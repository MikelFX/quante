// slug -> provider factory registry. Mirrors lib/fulfillment/registry.ts exactly. Adding a
// second media provider means: implement MediaProvider in providers/<slug>/, register its
// factory here — nothing in pipeline/nodes/images.ts or video.ts changes.

import type { MediaProvider } from './types'
import { createHiggsfieldProvider, type HiggsfieldCredentials } from './providers/higgsfield'

export type MediaProviderSlug = 'higgsfield'

type CredentialsFor<S extends MediaProviderSlug> = S extends 'higgsfield' ? HiggsfieldCredentials : never

const FACTORIES: {
  [S in MediaProviderSlug]: (creds: CredentialsFor<S>) => MediaProvider
} = {
  higgsfield: createHiggsfieldProvider,
}

export function createMediaProvider<S extends MediaProviderSlug>(
  slug: S,
  credentials: CredentialsFor<S>,
): MediaProvider {
  const factory = FACTORIES[slug]
  if (!factory) throw new Error(`Unknown media provider: ${slug}`)
  return factory(credentials)
}

export const MEDIA_PROVIDER_SLUGS: MediaProviderSlug[] = Object.keys(FACTORIES) as MediaProviderSlug[]
