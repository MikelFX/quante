import { ImageResponse } from 'next/og'
import { tokens } from '@ad/ui/tokens'
import { SITE_ORIGIN } from '@/lib/domains'

// Share image of the AssetraDigital website (og:image / twitter:image, set in app/(site)/layout.tsx).
// Its own route because app/opengraph-image.tsx is the Quante app's image and a second
// opengraph-image file for "/" would collide with it. Colours come from the design tokens.

export const dynamic = 'force-static'

const t = tokens.dark

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: `radial-gradient(circle at 82% 18%, rgba(95,245,196,.22), transparent 46%), ${t.bg}`,
          color: t.fg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, fontWeight: 700, letterSpacing: '0.08em' }}>
          <div style={{ width: 18, height: 18, borderRadius: 999, background: t.acc }} />
          ASSETRA DIGITAL
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em' }}>
            <span>Web nebo e-shop</span>
            <span style={{ color: t.acc }}>bez vstupní investice.</span>
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: t.fg2 }}>{new URL(SITE_ORIGIN).host}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
