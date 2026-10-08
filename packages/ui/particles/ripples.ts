// Ripples on the website's dot grid. Every disturbance — the pointer's wake as it moves across the
// page, a tap, the soft pulse of a resting pointer — sends out one ring-shaped wave packet: a few
// crests around a front that travels outward, losing strength with time and distance, calm behind
// it like water. The engine samples the sum of all packets at every dot: the height tints the dot
// (crest mint, trough blue) and the slope shifts it along the ring. Positions are page coordinates,
// so ripples stay where they were made while the page scrolls. Pure maths, no DOM — tested in
// __tests__/ad-ripples.test.mjs.

export const RIPPLE = {
  /** Front speed, px per ms. */
  speed: 0.4,
  /** Distance between crests, px. */
  wavelength: 110,
  /** Half-width of the packet around the front, px (≈ two visible rings). */
  width: 80,
  /** Distance over which spreading halves the strength, px. */
  spread: 170,
  /** Most packets alive at once; the oldest goes first. */
  max: 40,
  /** Below this strength a packet is dropped. */
  floor: 0.012,
} as const

export interface Ripple {
  x: number
  y: number
  /** Start time (performance.now ms). */
  t: number
  /** Initial strength (≈ height of the first crest). */
  a: number
  /** Time constant of the fade, ms. */
  life: number
}

export interface RippleSample {
  /** Height: > 0 crest, < 0 trough. */
  h: number
  /** Shift of the dot along the rings, px per unit (the engine scales it). */
  dx: number
  dy: number
}

const TAU = Math.PI * 2
/** Heights below this are invisible, so a packet is only computed where it can reach it. */
const VISIBLE = 0.02

/** Half-width of the band around the front where a packet of strength `amp` can still be seen. */
function reachOf(amp: number) {
  return amp > VISIBLE ? RIPPLE.width * Math.sqrt(Math.log(amp / VISIBLE)) : 0
}

export class Ripples {
  list: Ripple[] = []

  add(x: number, y: number, now: number, a: number, life: number) {
    this.list.push({ x, y, t: now, a, life })
    if (this.list.length > RIPPLE.max) this.list.shift()
  }

  /** Drops packets that faded out. */
  prune(now: number) {
    if (!this.list.length) return
    this.list = this.list.filter((r) => r.a * Math.exp(-(now - r.t) / r.life) >= RIPPLE.floor)
  }

  get empty() {
    return this.list.length === 0
  }

  clear() {
    this.list = []
  }

  /**
   * Sums all packets onto a lattice (origin ox, oy in page coordinates, `step` px apart, cols × rows)
   * into the height / shift buffers. Each packet only visits the lattice points inside its ring,
   * row by row, so the cost follows the area the waves cover, not dots × packets.
   */
  accumulate(now: number, ox: number, oy: number, step: number, cols: number, rows: number, H: Float32Array, DX: Float32Array, DY: Float32Array) {
    H.fill(0)
    DX.fill(0)
    DY.fill(0)
    const w = RIPPLE.width
    const w2 = w * w
    const k = TAU / RIPPLE.wavelength
    for (let n = 0; n < this.list.length; n++) {
      const r = this.list[n]
      const age = now - r.t
      if (age <= 0) continue
      const R = age * RIPPLE.speed
      const amp = (r.a * Math.exp(-age / r.life)) / Math.sqrt(1 + R / RIPPLE.spread)
      const reach = reachOf(amp)
      if (!reach) continue
      const cx = (r.x - ox) / step
      const cy = (r.y - oy) / step
      const o = (R + reach) / step
      const inn = Math.max(0, R - reach) / step
      const o2 = o * o
      const in2 = inn * inn
      const j0 = Math.max(0, Math.ceil(cy - o))
      const j1 = Math.min(rows - 1, Math.floor(cy + o))
      for (let j = j0; j <= j1; j++) {
        const dyc = j - cy
        const dy2 = dyc * dyc
        const so = Math.sqrt(Math.max(0, o2 - dy2))
        const si = in2 > dy2 ? Math.sqrt(in2 - dy2) : -1
        const ey = dyc * step
        const row = j * cols
        // One span across the ring, or two when the row cuts through the calm middle.
        for (let part = 0; part < (si < 0 ? 1 : 2); part++) {
          const a = si < 0 ? cx - so : part === 0 ? cx - so : cx + si
          const b = si < 0 ? cx + so : part === 0 ? cx - si : cx + so
          const i0 = Math.max(0, Math.ceil(a))
          const i1 = Math.min(cols - 1, Math.floor(b))
          for (let i = i0; i <= i1; i++) {
            const ex = (i - cx) * step
            const d = Math.sqrt(ex * ex + ey * ey) || 1
            const s = d - R
            const env = amp * Math.exp(-(s * s) / w2)
            const phase = k * s
            const idx = row + i
            H[idx] += env * Math.cos(phase)
            const push = env * Math.sin(phase)
            DX[idx] += (ex / d) * push
            DY[idx] += (ey / d) * push
          }
        }
      }
    }
  }

  /** Sum of all packets at page point (x, y), written into `out`. */
  sample(x: number, y: number, now: number, out: RippleSample): RippleSample {
    let h = 0
    let dx = 0
    let dy = 0
    const w = RIPPLE.width
    const k = TAU / RIPPLE.wavelength
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i]
      const age = now - r.t
      if (age <= 0) continue
      const R = age * RIPPLE.speed
      const amp = (r.a * Math.exp(-age / r.life)) / Math.sqrt(1 + R / RIPPLE.spread)
      const reach = reachOf(amp)
      if (!reach) continue
      const ex = x - r.x
      const ey = y - r.y
      const d2 = ex * ex + ey * ey
      const hi = R + reach
      if (d2 > hi * hi) continue
      const lo = R - reach
      if (lo > 0 && d2 < lo * lo) continue
      const d = Math.sqrt(d2) || 1
      const s = d - R
      const env = Math.exp(-(s * s) / (w * w))
      const phase = k * s
      h += amp * env * Math.cos(phase)
      const push = amp * env * Math.sin(phase)
      dx += (ex / d) * push
      dy += (ey / d) * push
    }
    out.h = h
    out.dx = dx
    out.dy = dy
    return out
  }
}
