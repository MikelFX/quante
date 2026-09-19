import { HomePageClient } from './HomePageClient'
import { buildMetadata, SITE_URL, SITE_NAME } from '@/lib/seo'
import { operator } from '@/lib/site-config'
import { HOSTING_ANNUAL_USD } from '@/lib/config'

// Server-side shell: exports metadata and emits the site-wide JSON-LD
// (Organization + SoftwareApplication) so the homepage is indexable
// with rich results. Interactive UI lives in HomePageClient — the old
// 500-line 'use client' page renamed and re-exported.

export const metadata = buildMetadata({
  title: 'Describe your online store. Get real Next.js code',
  description:
    'Describe an online store — Quante generates a real Next.js project you can export and own outright. 25 free credits, no card required.',
  path: '/',
})

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: operator.companyName,
  legalName: operator.companyName,
  url: SITE_URL,
  // TODO(michal): add real logo asset URL — /public/logo-1200.png or similar.
  // Empty logo is OK for now (Google will use OG image), but a dedicated
  // logo asset unlocks the knowledge-panel + brand-signal treatment.
  logo: undefined,
  founder: {
    '@type': 'Person',
    name: operator.founderName,
    jobTitle: operator.founderRole,
  },
  // Contact left off intentionally until operator.contactEmail is
  // filled in (currently TODO(michal)). Google penalises fake contacts
  // more than missing ones.
}

const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'E-commerce store builder',
  operatingSystem: 'Web (any modern browser)',
  offers: {
    '@type': 'Offer',
    price: HOSTING_ANNUAL_USD,
    priceCurrency: 'USD',
    priceValidUntil: `${new Date().getFullYear() + 1}-12-31`,
    availability: 'https://schema.org/InStock',
    // Hosting price is the recurring commitment we advertise as a
    // subscription; credit packs are itemProperty consumables. Offer
    // block advertises the plan a search visitor would sign up for.
  },
  publisher: { '@type': 'Organization', name: operator.companyName },
  url: SITE_URL,
  description:
    'AI-powered e-commerce store generator. Describe a store, receive a complete Next.js project you can export, deploy on Quante or self-host anywhere.',
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // dangerouslySetInnerHTML is the standard Next.js pattern for
        // JSON-LD blocks; the JSON is stringified from a known-safe
        // typed literal, so there's no injection surface.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <HomePageClient />
    </>
  )
}
