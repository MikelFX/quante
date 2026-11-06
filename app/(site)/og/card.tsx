import { ImageResponse } from 'next/og'
import { AD_MARK_PATH, AD_MARK_PIXEL, AD_MARK_VIEWBOX } from '@ad/ui/mark'
import { tokens } from '@ad/ui/tokens'

// Share cards (og:image / twitter:image) of both hosts, drawn the same way: the pixel-A mark + name
// at the top, a two-line headline, the host. Its own routes (/og, /og/quante) because
// app/opengraph-image.tsx would collide for "/". Colours come from the design tokens; Quante's
// mint is the .ad-q accent (site.css) — Quante stays green, AssetraDigital magenta.

const t = tokens.dark

export function shareCard({ name, lines, accent, glow, host }: { name: string; lines: [string, string]; accent: string; glow: string; host: string }) {
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
          background: `radial-gradient(circle at 82% 18%, ${glow}, transparent 46%), ${t.bg}`,
          color: t.fg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 32, fontWeight: 700, letterSpacing: '0.08em' }}>
          <svg width="56" height="56" viewBox={AD_MARK_VIEWBOX}>
            <path d={AD_MARK_PATH} fill={t.fg} />
            <rect x={AD_MARK_PIXEL.x} y={AD_MARK_PIXEL.y} width={AD_MARK_PIXEL.size} height={AD_MARK_PIXEL.size} fill={accent} />
          </svg>
          {name}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.02em' }}>
            <span>{lines[0]}</span>
            <span style={{ color: accent }}>{lines[1]}</span>
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: t.fg2 }}>{host}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
