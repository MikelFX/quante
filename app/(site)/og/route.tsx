import { SITE_ORIGIN } from '@/lib/domains'
import { tokens } from '@ad/ui/tokens'
import { shareCard } from './card'

// Share image of the AssetraDigital website (og:image / twitter:image, set in app/(site)/layout.tsx).

export const dynamic = 'force-static'

export function GET() {
  return shareCard({
    name: 'ASSETRA DIGITAL',
    lines: ['AI řešení a software', 'na míru.'],
    accent: tokens.dark.acc,
    glow: 'rgba(255,90,210,.22)',
    host: new URL(SITE_ORIGIN).host,
  })
}
