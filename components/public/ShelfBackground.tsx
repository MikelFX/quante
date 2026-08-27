// Subtle warehouse-shelving silhouette used behind public-site hero (and
// optionally other) sections — ties the visual language back to Quante's
// shared-fulfillment/warehouse roadmap without reading as literal iconography.
// Kept intentionally faint; opacity is reduced further on mobile via the
// `.qp-shelf-layer` rule in globals.css.
export function ShelfBackground({ variant = 'a' }: { variant?: 'a' | 'b' }) {
  if (variant === 'b') {
    return (
      <div className="qp-shelf-layer" aria-hidden="true">
        <svg width="100%" height="820" viewBox="0 0 1400 820" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
          <g stroke="var(--qp-shelf-b)" strokeWidth={2.4} fill="none" opacity={0.9}>
            <g transform="translate(980,-40) rotate(8)">
              <line x1="0" y1="0" x2="0" y2="430" />
              <line x1="230" y1="0" x2="230" y2="430" />
              <line x1="0" y1="90" x2="230" y2="90" />
              <line x1="0" y1="210" x2="230" y2="210" />
              <line x1="0" y1="330" x2="230" y2="330" />
              <rect x="20" y="20" width="80" height="56" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="120" y="18" width="86" height="58" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="24" y="120" width="94" height="72" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="132" y="132" width="70" height="60" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="20" y="240" width="188" height="72" rx="6" fill="var(--qp-shelf-b-soft)" />
            </g>
            <g transform="translate(-40,540) rotate(-6)">
              <line x1="0" y1="0" x2="0" y2="260" />
              <line x1="170" y1="0" x2="170" y2="260" />
              <line x1="0" y1="70" x2="170" y2="70" />
              <line x1="0" y1="170" x2="170" y2="170" />
              <rect x="16" y="14" width="70" height="42" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="98" y="18" width="54" height="38" rx="6" fill="var(--qp-shelf-b-soft)" />
              <rect x="18" y="94" width="134" height="60" rx="6" fill="var(--qp-shelf-b-soft)" />
            </g>
            <g transform="translate(1290,260)">
              <line x1="0" y1="0" x2="0" y2="300" />
              <line x1="90" y1="0" x2="90" y2="300" />
              <line x1="0" y1="100" x2="90" y2="100" />
              <line x1="0" y1="200" x2="90" y2="200" />
              <rect x="12" y="14" width="66" height="70" rx="5" fill="var(--qp-shelf-b-soft)" />
              <rect x="12" y="114" width="66" height="70" rx="5" fill="var(--qp-shelf-b-soft)" />
            </g>
          </g>
        </svg>
      </div>
    )
  }

  return (
    <div className="qp-shelf-layer" aria-hidden="true">
      <svg width="100%" height="820" viewBox="0 0 1400 820" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="qpFadeMaskA">
            <rect width="1400" height="820" fill="white" />
            <rect width="1400" height="140" fill="url(#qpGTop)" />
            <rect y="620" width="1400" height="200" fill="url(#qpGBot)" />
            <rect width="90" height="820" fill="url(#qpGLeft)" />
            <rect x="1310" width="90" height="820" fill="url(#qpGRight)" />
          </mask>
          <linearGradient id="qpGTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="black" /><stop offset="1" stopColor="white" /></linearGradient>
          <linearGradient id="qpGBot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="white" /><stop offset="1" stopColor="black" /></linearGradient>
          <linearGradient id="qpGLeft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="black" /><stop offset="1" stopColor="white" /></linearGradient>
          <linearGradient id="qpGRight" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="white" /><stop offset="1" stopColor="black" /></linearGradient>
        </defs>
        <g mask="url(#qpFadeMaskA)" stroke="var(--qp-shelf)" strokeWidth={2} fill="none">
          {/* Three distinct shelf-unit shapes instead of one tile stamped
              across the whole width — different box counts/sizes and, for
              unit C, fewer shelf lines (a "gappier" bay) so the pattern
              doesn't read as a uniform grid. */}
          <g id="qpShelfUnitA">
            <line x1="0" y1="120" x2="0" y2="700" />
            <line x1="150" y1="120" x2="150" y2="700" />
            <line x1="0" y1="200" x2="150" y2="200" />
            <line x1="0" y1="340" x2="150" y2="340" />
            <line x1="0" y1="480" x2="150" y2="480" />
            <line x1="0" y1="620" x2="150" y2="620" />
            <rect x="14" y="150" width="46" height="38" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="76" y="155" width="52" height="34" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="18" y="230" width="58" height="94" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="20" y="370" width="44" height="40" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="80" y="365" width="50" height="48" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="16" y="510" width="60" height="94" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="18" y="650" width="112" height="38" rx="4" fill="var(--qp-shelf-soft)" />
          </g>
          <g id="qpShelfUnitB">
            <line x1="0" y1="80" x2="0" y2="760" />
            <line x1="150" y1="80" x2="150" y2="760" />
            <line x1="0" y1="220" x2="150" y2="220" />
            <line x1="0" y1="440" x2="150" y2="440" />
            <line x1="0" y1="620" x2="150" y2="620" />
            <rect x="16" y="106" width="118" height="94" rx="5" fill="var(--qp-shelf-soft)" />
            <rect x="22" y="252" width="52" height="164" rx="5" fill="var(--qp-shelf-soft)" />
            <rect x="86" y="270" width="46" height="146" rx="5" fill="var(--qp-shelf-soft)" />
            <rect x="18" y="466" width="114" height="128" rx="5" fill="var(--qp-shelf-soft)" />
            <rect x="24" y="646" width="102" height="88" rx="5" fill="var(--qp-shelf-soft)" />
          </g>
          <g id="qpShelfUnitC">
            <line x1="0" y1="220" x2="0" y2="560" />
            <line x1="150" y1="220" x2="150" y2="560" />
            <line x1="0" y1="300" x2="150" y2="300" />
            <line x1="0" y1="460" x2="150" y2="460" />
            <rect x="20" y="246" width="44" height="38" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="82" y="238" width="48" height="48" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="26" y="326" width="98" height="112" rx="4" fill="var(--qp-shelf-soft)" />
            <rect x="18" y="486" width="56" height="58" rx="4" fill="var(--qp-shelf-soft)" />
          </g>
          {[
            { x: 0, ref: 'qpShelfUnitA', dy: 0, op: 1 },
            { x: 150, ref: 'qpShelfUnitB', dy: -20, op: 0.7 },
            { x: 300, ref: 'qpShelfUnitC', dy: 24, op: 0.5 },
            { x: 450, ref: 'qpShelfUnitA', dy: 8, op: 0.85 },
            { x: 600, ref: 'qpShelfUnitB', dy: -14, op: 0.6 },
            { x: 750, ref: 'qpShelfUnitC', dy: 0, op: 0.9 },
            { x: 900, ref: 'qpShelfUnitA', dy: -22, op: 0.65 },
            { x: 1050, ref: 'qpShelfUnitB', dy: 14, op: 0.8 },
            { x: 1200, ref: 'qpShelfUnitC', dy: -10, op: 0.55 },
          ].map((u, i) => (
            <use key={i} href={`#${u.ref}`} x={u.x} y={u.dy} opacity={u.op} />
          ))}
        </g>
      </svg>
    </div>
  )
}
