// AD mark + QUANTE wordmark for Quante pages outside the app shell (sign-in, Qads, legal).
// Self-contained styles (no .ad scope needed); colours come from the --q-* tokens.
export function QuanteBrand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const w = size === 'lg' ? 36 : 28
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--q-fg)' }}>
      <svg viewBox="0 0 44 32" width={w} height={(w * 32) / 44} aria-hidden="true" style={{ overflow: 'visible' }}>
        <path d="M3 29 L20 3 L20 29 M20 3 H25 A13 13 0 0 1 25 29 H20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" strokeLinejoin="miter" />
        <rect x="12.6" y="18.2" width="4.6" height="4.6" style={{ fill: 'var(--q-acc)' }} />
      </svg>
      <span style={{ font: `700 ${size === 'lg' ? 12 : 11}px/1 var(--q-mono)`, letterSpacing: '.16em', textTransform: 'uppercase' }}>Quante</span>
    </span>
  )
}
