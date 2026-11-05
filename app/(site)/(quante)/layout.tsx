import type { Metadata } from 'next'
import { APP_ORIGIN } from '@/lib/domains'
import { QuanteFooter } from '../_components/quante/QuanteFooter'
import { QuanteHeader } from '../_components/quante/QuanteHeader'
import { jsonLdString, quanteJsonLd } from '@/lib/agents/jsonld'

// The Quante product pages live on quantecode.com (lib/domains.ts QUANTE_PATHS): canonical and
// share URLs resolve against the app host.
export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: { default: 'Quante', template: '%s · Quante' },
}

/** Quante's pages: Quante's own nav and footer, Quante's green accents inside the website design
 *  (site.css, .ad-q). Nothing of the AssetraDigital menu: quantecode.com is the Quante products only. */
export default function QuanteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ad-q">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(quanteJsonLd()) }} />
      <QuanteHeader />
      <main>{children}</main>
      <QuanteFooter />
    </div>
  )
}
