// Decorative full-width pieces: crossed marquee tapes, binary strips, the giant wordmark, grain.

export function Tapes({ words, items, label }: { words: string[]; items: { n: string; d: string }[]; label: string }) {
  const a = [...words, ...words, ...words, ...words]
  const b = [...items, ...items, ...items, ...items]
  return (
    <div className="tapes" role="img" aria-label={label}>
      <div className="tape a" aria-hidden="true">
        <div className="tr">{a.map((t, i) => <span key={i}>{t}<i /></span>)}</div>
      </div>
      <div className="tape b" aria-hidden="true">
        <div className="tr">{b.map((t, i) => <span key={i}>{t.n}<em>{t.d}</em><i /></span>)}</div>
      </div>
    </div>
  )
}

const enc = (str: string) => str.split('').map((ch) => ch.charCodeAt(0).toString(2).padStart(8, '0')).join('/')

/** The text written out in 8-bit binary, running slowly sideways. Use ASCII text. */
export function BinaryStrip({ text }: { text: string }) {
  const one = enc(text)
  return <div className="bin" aria-hidden="true"><span>{one + '/' + one}</span></div>
}

/** ASSETRA ■ DIGITAL — letters widen under the pointer (and breathe on touch screens). */
export function GiantWordmark({ a = 'ASSETRA', b = 'DIGITAL' }: { a?: string; b?: string }) {
  const letters = (str: string, off: number) =>
    str.split('').map((t, i) => <span key={off + i} className="lt" style={{ animationDelay: ((i + off) * 0.12).toFixed(2) + 's' }}>{t}</span>)
  return (
    <div className="giant" aria-hidden="true">
      {letters(a, 0)}
      <i className="px" />
      {letters(b, a.length + 1)}
    </div>
  )
}

export function Grain() {
  return <div className="grain" aria-hidden="true" />
}
