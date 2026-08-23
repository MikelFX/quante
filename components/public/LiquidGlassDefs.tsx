// Hidden SVG holding the "liquid glass" refraction filter referenced by
// `.qp-liquid-glass` (backdrop-filter: url(#qp-liquid-distort) ...) in
// globals.css. Needs to exist once in the DOM on any page that uses
// .qp-liquid-glass — rendered via <PublicNav>, which every public page
// includes, so this doesn't need to be added per-page.
export function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="qp-liquid-distort" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={2} seed={7} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={22} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}
