import type { CSSProperties } from 'react'
import { cx } from '@ad/ui'
import type { Object3DKind } from '@/content/assetra/ai'

// Glossy 3D objects for the homepage (owner's reference, 2026-10-26): a thick, tilted slab with a
// magenta → warm-orange face, a recessed panel and raised glass pieces that form a symbol. Pure
// CSS (site.css, .o3*): the slab's thickness is real 3D — LAYERS copies stepped back in Z.
// Decorative only, so aria-hidden; it stands still with animations off.

type Shape = 'key' | 'orb' | 'bar' | 'rod' | 'star'
/** One piece on the panel: shape, left, top, width, height (% of the panel), rotation in degrees. */
type Part = [Shape, number, number, number, number, number?]

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
  plug: [
    ['bar', 30, 45, 40, 10],
    ['key', 6, 26, 34, 48],
    ['key', 60, 26, 34, 48],
    ['bar', 66, 14, 6, 14],
    ['bar', 82, 14, 6, 14],
    ['orb', 16, 42, 14, 14],
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
  flow: [
    ['rod', 22, 22, 56, 7],
    ['rod', 26, 52, 52, 7, 52],
    ['key', 6, 8, 30, 30],
    ['key', 64, 8, 30, 30],
    ['key', 35, 62, 30, 30],
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

const LAYERS = 7

export function Object3D({ kind, size = 'md', className, style }: { kind: Object3DKind; size?: 'sm' | 'md' | 'lg'; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('o3', 'o3-' + size, className)} style={style} aria-hidden="true">
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
