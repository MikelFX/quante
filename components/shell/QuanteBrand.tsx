import { AD_MARK_PATH, AD_MARK_PIXEL, AD_MARK_VIEWBOX } from '@ad/ui/mark'

// The pixel-A mark + QUANTE wordmark for Quante pages outside the app shell (sign-in, Qads, Qscan,
// legal). Self-contained styles (no .ad scope needed); colours come from the --q-* tokens.
export function QuanteBrand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const w = size === 'lg' ? 30 : 24
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--q-fg)' }}>
      <svg viewBox={AD_MARK_VIEWBOX} width={w} height={w} aria-hidden="true">
        <path d={AD_MARK_PATH} fill="currentColor" />
        <rect x={AD_MARK_PIXEL.x} y={AD_MARK_PIXEL.y} width={AD_MARK_PIXEL.size} height={AD_MARK_PIXEL.size} style={{ fill: 'var(--q-acc)' }} />
      </svg>
      <span style={{ font: `700 ${size === 'lg' ? 12 : 11}px/1 var(--q-mono)`, letterSpacing: '.16em', textTransform: 'uppercase' }}>Quante</span>
    </span>
  )
}
