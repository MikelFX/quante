import { PricingClient } from './PricingClient'
import { buildMetadata } from '@/lib/seo'
import { PRICING_FAQ } from '@/lib/faq'

export const metadata = buildMetadata({
  title: 'Pricing — credits and optional hosting',
  description:
    'Pay only for what you create. Credits never expire. Optional hosting from $9.99/month with SSL and CDN. 12 free credits on signup.',
  path: '/pricing',
})

// FAQPage schema pulled from lib/faq.ts — the exact same list the page
// renders below, so the SERP FAQ rich result and the visible FAQ can
// never diverge. Audit brief 3.
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: PRICING_FAQ.map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.a,
    },
  })),
}

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <PricingClient />
    </>
  )
}
