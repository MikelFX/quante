import { APP_ORIGIN } from '@/lib/domains'
import { shareCard } from '../card'

// Share image of the Quante pages (quanteShare in _components/seo.ts, buildMetadata in lib/seo.ts).
// Served from the website host (/og is a SITE_PATH) and linked by its absolute URL.

export const dynamic = 'force-static'

/** Quante's mint accent: .ad .ad-q --acc in site.css. */
const QUANTE_MINT = '#5ff5c4'

export function GET() {
  return shareCard({
    name: 'QUANTE',
    lines: ['Celý e-shop', 'na jednom místě.'],
    accent: QUANTE_MINT,
    glow: 'rgba(95,245,196,.18)',
    host: new URL(APP_ORIGIN).host,
  })
}
