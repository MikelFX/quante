'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import { cx } from '@ad/ui'
import type { Object3DKind } from '@/content/assetra/ai'

// Glossy 3D objects for the homepage (owner's reference, 2026-10-26): a thick, tilted slab with a
// magenta → warm-orange face, a recessed panel and raised glass pieces that form a symbol. Pure
// CSS (site.css, .o3*): the slab's thickness is real 3D — LAYERS copies stepped back in Z.
// Decorative only, so aria-hidden; it stands still with animations off. It only sways while on
// screen (data-play, IntersectionObserver): a dozen 3D objects animating out of view made
// scrolling stutter on phones. Small ones sway only when asked (`sway`, the hero's floaters).

type Shape = 'key' | 'orb' | 'bar' | 'rod' | 'star'
/** One piece on the panel: shape, left, top, width, height (% of the panel), rotation in degrees. */
type Part = [Shape, number, number, number, number, number?]

/** A rod from (x1, y1) to (x2, y2), h thick — rotated about its centre. */
function link(x1: number, y1: number, x2: number, y2: number, h = 4): Part {
  const len = Math.hypot(x2 - x1, y2 - y1)
  return ['rod', (x1 + x2) / 2 - len / 2, (y1 + y2) / 2 - h / 2, len, h, Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI)]
}

const GRID: Part[] = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c): Part => ['key', 6 + c * 31, 6 + r * 31, 26, 26]))

const PARTS: Record<Object3DKind, Part[]> = {
  grid: GRID,
  core: [
    ['rod', 10, 48, 80, 4, 45],
    ['rod', 10, 48, 80, 4, -45],
    ['orb', 6, 6, 20, 20],
    ['orb', 74, 6, 20, 20],
    ['orb', 6, 74, 20, 20],
    ['orb', 74, 74, 20, 20],
    ['orb', 30, 30, 40, 40],
  ],
  // AI hub (orb) wired to three of your systems: two panels with text lines, one plug.
  plug: [
    link(22, 25, 50, 50),
    link(22, 75, 50, 50),
    link(50, 50, 80, 50),
    ['key', 5, 8, 34, 34],
    ['key', 5, 58, 34, 34],
    ['key', 66, 26, 29, 48],
    ['bar', 70, 10, 6, 18],
    ['bar', 84, 10, 6, 18],
    ['rod', 11, 17, 20, 4],
    ['rod', 11, 25, 13, 4],
    ['rod', 11, 33, 17, 4],
    ['orb', 11, 67, 10, 10],
    ['rod', 23, 70, 10, 4],
    ['rod', 11, 81, 20, 4],
    ['rod', 71, 36, 19, 4],
    ['orb', 75, 54, 11, 11],
    ['orb', 37, 37, 26, 26],
  ],
  crm: [
    ['orb', 12, 8, 30, 30],
    ['key', 6, 44, 42, 48],
    ['bar', 56, 14, 38, 12],
    ['bar', 56, 44, 30, 12],
    ['bar', 56, 74, 38, 12],
  ],
  chat: [
    ['key', 6, 8, 74, 50],
    ['key', 34, 64, 60, 28],
    ['orb', 18, 26, 13, 13],
    ['orb', 37, 26, 13, 13],
    ['orb', 56, 26, 13, 13],
  ],
  // Documents and e-mails in, AI (orb) in the middle, sorted checklist out.
  flow: [
    link(30, 27, 52, 50),
    link(30, 75, 52, 50),
    link(52, 50, 74, 50),
    ['key', 5, 6, 30, 40],
    ['rod', 11, 15, 18, 4],
    ['rod', 11, 23, 18, 4],
    ['rod', 11, 31, 11, 4],
    ['key', 5, 58, 30, 34],
    link(10, 67, 20, 75, 3.5),
    link(20, 75, 30, 67, 3.5),
    ['key', 68, 8, 27, 84],
    ['orb', 73, 20, 8, 8],
    ['rod', 84, 22, 8, 4],
    ['orb', 73, 46, 8, 8],
    ['rod', 84, 48, 8, 4],
    ['orb', 73, 72, 8, 8],
    ['rod', 84, 74, 8, 4],
    ['orb', 40, 38, 24, 24],
  ],
  shop: [
    ['bar', 6, 6, 88, 14],
    ['key', 6, 28, 54, 66],
    ['key', 66, 28, 28, 30],
    ['key', 66, 64, 28, 30],
  ],
  bars: [
    ['key', 8, 56, 22, 38],
    ['key', 39, 34, 22, 60],
    ['key', 70, 8, 22, 86],
  ],
  tiles: [
    ['key', 8, 8, 38, 38],
    ['key', 54, 8, 38, 38],
    ['key', 8, 54, 38, 38],
    ['key', 54, 54, 38, 38],
  ],
  spark: [
    ['star', 12, 12, 76, 76],
    ['orb', 72, 6, 16, 16],
  ],
  person: [
    ['orb', 30, 6, 40, 40],
    ['key', 14, 52, 72, 42],
  ],
}

const LAYERS = 4

export function Object3D({ kind, size = 'md', sway = size !== 'sm', className, style }: { kind: Object3DKind; size?: 'sm' | 'md' | 'lg'; sway?: boolean; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !sway || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => { el.dataset.play = e.isIntersecting ? '1' : '' })
    io.observe(el)
    return () => io.disconnect()
  }, [sway])
  return (
    <div ref={ref} className={cx('o3', 'o3-' + size, className)} style={style} aria-hidden="true">
      <i className="o3-g" />
      <div className="o3-r">
        {Array.from({ length: LAYERS }, (_, i) => <b key={i} className="o3-e" style={{ '--z': i + 1 } as CSSProperties} />)}
        <div className="o3-f">
          <div className="o3-p">
            {PARTS[kind].map(([shape, x, y, w, h, rot], i) => (
              <i
                key={i}
                className={'o3-' + shape}
                style={{ left: x + '%', top: y + '%', width: w + '%', height: h + '%', ...(rot ? { transform: `rotate(${rot}deg)` } : {}) }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
