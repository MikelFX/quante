// slug -> provider factory registry. Adding a second fulfillment provider (Skladon,
// Shipmonk, ...) means: implement FulfillmentProvider in providers/<slug>/, register its
// factory here, add its credential columns to project_secrets (+ encrypt them, see
// app/api/projects/[id]/settings/route.ts) — nothing in the checkout/order flow changes.

import type { FulfillmentProvider } from './types'
import { createByrdProvider, type ByrdCredentials } from './providers/byrd'

export type FulfillmentProviderSlug = 'byrd'

// Credentials shape differs per provider — keep it a union keyed by slug rather than a
// lowest-common-denominator object, so each provider's factory gets exactly what it needs.
type CredentialsFor<S extends FulfillmentProviderSlug> = S extends 'byrd' ? ByrdCredentials : never

const FACTORIES: {
  [S in FulfillmentProviderSlug]: (creds: CredentialsFor<S>) => FulfillmentProvider
} = {
  byrd: createByrdProvider,
}

export function createFulfillmentProvider<S extends FulfillmentProviderSlug>(
  slug: S,
  credentials: CredentialsFor<S>,
): FulfillmentProvider {
  const factory = FACTORIES[slug]
  if (!factory) throw new Error(`Unknown fulfillment provider: ${slug}`)
  return factory(credentials)
}

export const FULFILLMENT_PROVIDER_SLUGS: FulfillmentProviderSlug[] = Object.keys(FACTORIES) as FulfillmentProviderSlug[]
