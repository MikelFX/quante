import { ImageResponse } from 'next/og'
import { SITE_NAME } from '@/lib/seo'

// Site-wide default Open Graph image. Next.js serves this at
// /opengraph-image (also emitted as og:image + twitter:image defaults
// on every page that doesn't override). Dynamic renderer via next/og so
// the image inherits any future copy change here without redeploying an
// asset. Matches the light-minimal marketing theme: near-white bg,
// near-black wordmark, near-black caption line, a single black dot as
// the "action" mark.

export const runtime = 'edge'
export const alt = 'Quante — AI e-commerce store generator'
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
          {SITE_NAME.toLowerCase()}
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
            Describe your online store.
            <br />
            Get real Next.js code.
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#52525A',
              letterSpacing: '-0.01em',
              maxWidth: 900,
            }}
          >
            12 free credits · export any time · no lock-in
          </div>
        </div>
      </div>
    ),
    size,
  )
}
