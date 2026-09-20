import { ImageResponse } from 'next/og'
import { SITE_NAME } from '@/lib/seo'
import { HOSTING_ANNUAL_USD, HOSTING_MONTHLY_USD } from '@/lib/config'

// Pricing-specific OG image. Leads with the "no subscription" line
// instead of the generic hero copy so search-preview cards on
// /pricing shares have a different pitch than the homepage share.
// Same visual language as the root opengraph-image.

export const runtime = 'edge'
export const alt = 'Quante pricing — no subscription to build, optional hosting'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            fontSize: 28,
            fontWeight: 600,
            color: '#0A0A0A',
            letterSpacing: '-0.01em',
          }}
        >
          <span
            style={{
              display: 'block',
              width: 14,
              height: 14,
              borderRadius: 4,
              background: '#D4FF3F',
            }}
          />
          {SITE_NAME.toLowerCase()} · pricing
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              letterSpacing: '-0.035em',
              lineHeight: 1.05,
              color: '#0A0A0A',
              maxWidth: 900,
            }}
          >
            No subscription to build.
            <br />
            Optional hosting.
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#52525A',
              letterSpacing: '-0.01em',
              maxWidth: 900,
            }}
          >
            {`Credits pay per action. Hosting $${HOSTING_ANNUAL_USD}/year or $${HOSTING_MONTHLY_USD}/month. 12 free credits on signup.`}
          </div>
        </div>
      </div>
    ),
    size,
  )
}
