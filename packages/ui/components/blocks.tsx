import { cx, delay } from './primitives'

/** Cards that pile onto each other while scrolling (sticky, each 16 px lower). */
export function StackCards({ items, top = 100, step = 16 }: { items: { title: string; code: string }[]; top?: number; step?: number }) {
  return (
    <div className="stack">
      {items.map((it, i) => (
        <div className="sc" key={it.title} style={{ top: top + i * step }}>
          <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <h3>{it.title}</h3>
          <code>{it.code}</code>
        </div>
      ))}
    </div>
  )
}

/**
 * A number whose digits spin in like a slot machine once the section is in view.
 * Screen readers get the plain value; the digit columns are hidden from them.
 */
export function SlotNumber({ value, base = 0.1 }: { value: string; base?: number }) {
  return (
    <>
      <span className="vh">{value}</span>
      {value.split('').map((ch, i) =>
        ch === ' ' ? (
          <span key={i} className="sp" aria-hidden="true" />
        ) : (
          <span key={i} className="dg" aria-hidden="true">
            <i style={{ transform: `translateY(-${ch}em)`, animationDelay: (base + i * 0.07).toFixed(2) + 's' }}>0123456789</i>
          </span>
        ),
      )}
    </>
  )
}

export interface TimelineStep {
  hash: string
  title: string
  text: string
}

/** Steps on a rail whose glowing line fills as you scroll. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="proc">
      <div className="rail" aria-hidden="true"><i /></div>
      {steps.map((s, i) => (
        <div className={cx('pst glass spot rv')} style={delay(0.1 * (i + 1))} key={s.title}>
          <span className="nd" aria-hidden="true" />
          <div><span className="hs" aria-hidden="true">{s.hash}</span><h3>{s.title}</h3></div>
          <span className="k" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  )
}
