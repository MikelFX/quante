// One particle formation: the dots of one <ParticleZone>, in the zone's own coordinates (origin at
// its centre, px). Owner, 2026-10-12: a formation stays on its place. It turns, sways and changes
// shape there, but never travels to another zone, and neither the mouse nor a finger moves it. The
// engine draws it into a canvas inside the zone, so it scrolls with the page exactly.
// Pure maths, no DOM — tested in __tests__/ad-particles.test.mjs.

import type { Shape } from './shapes'

/**
 * How far the 3D shapes reach from the zone centre, as a share of the zone's shorter side (measured
 * over every rotation step() uses). Flat shapes (the logo, words) are fitted into 0.46 w × 0.44 h.
 */
const REACH: Record<string, readonly [number, number]> = {
  '@sphere': [0.43, 0.43],
  '@torus': [0.43, 0.33],
  '@cube': [0.76, 0.83],
  '@wave': [0.52, 0.43],
}
/**
 * The springs overshoot when the formation changes shape (up to 27 % of a dot's jump). A word
 * turning into another word throws its stiffest dots up to about a fifth of the zone past its edges
 * (measured: 0.2 % of the dots at the worst frame beyond 0.15); 3D shapes need 20 % on top of their reach.
 */
const FLAT_SWING = 0.18
const SWING_3D = 0.2
/** Room for a burst and the dot size, px. */
const EDGE = 16

/** The space a formation's canvas needs around its zone on each side, px. */
export function canvasPad(keys: readonly string[], w: number, h: number): { x: number; y: number } {
  const m = Math.min(w, h)
  let x = FLAT_SWING * w
  let y = FLAT_SWING * h
  for (const k of keys) {
    const r = REACH[k]
    if (r) {
      x = Math.max(x, r[0] * m * (1 + SWING_3D) - w / 2)
      y = Math.max(y, r[1] * m * (1 + SWING_3D) - h / 2)
    }
  }
  return { x: Math.ceil(x) + EDGE, y: Math.ceil(y) + EDGE }
}

export class Formation {
  readonly n: number
  /** Where each dot is, relative to the zone centre. */
  readonly px: Float32Array
  readonly py: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  /** Each dot's place in the shape after the last step. */
  readonly tx: Float32Array
  readonly ty: Float32Array
  /** 0 (far side) … 1 (near side): size and opacity. */
  readonly depth: Float32Array
  /** Scale of the last step, px per shape unit. */
  sc = 0
  private readonly k: Float32Array

  constructor(n: number, rand: () => number = Math.random) {
    this.n = n
    this.px = new Float32Array(n)
    this.py = new Float32Array(n)
    this.vx = new Float32Array(n)
    this.vy = new Float32Array(n)
    this.tx = new Float32Array(n)
    this.ty = new Float32Array(n)
    this.depth = new Float32Array(n)
    this.k = new Float32Array(n)
    for (let i = 0; i < n; i++) this.k[i] = 0.02 + rand() * 0.035
  }

  /** A small scatter the springs pull back together (every shape change). */
  burst(f: number, rand: () => number = Math.random) {
    for (let i = 0; i < this.n; i++) {
      this.vx[i] += (rand() - 0.5) * f * 2
      this.vy[i] += (rand() - 0.5) * f * 2
    }
  }

  /**
   * One frame: the pose of `shape` at time T (s) in a w × h zone, and every dot one spring step
   * towards its place in it. With animations off (`on` false) the pose holds still and the dots sit
   * on it; `snap` puts them there at once (a formation coming into view is already formed).
   */
  step(shape: Shape, T: number, w: number, h: number, on: boolean, snap: boolean) {
    const flat = shape.flat
    const sc = flat
      ? Math.min((w * 0.46) / Math.max(shape.ex, 0.01), (h * 0.44) / Math.max(shape.ey, 0.01))
      : Math.min(w, h) * 0.4
    const rotY = flat ? (on ? Math.sin(T * 0.6) * (shape.text ? 0.14 : 0.32) : 0) : on ? T * 0.5 : 0.6
    const rotX = flat ? (on ? Math.sin(T * 0.45) * 0.12 : 0) : 0.35 + (on ? Math.sin(T * 0.3) * 0.15 : 0)
    const wt = on ? T : 0
    const cY = Math.cos(rotY)
    const sY = Math.sin(rotY)
    const cX = Math.cos(rotX)
    const sX = Math.sin(rotX)
    const P = shape.p
    const { px, py, vx, vy, tx, ty, depth, k } = this
    const free = on && !snap
    for (let i = 0; i < this.n; i++) {
      const o = i * 3
      const x0 = P[o]
      const z0 = P[o + 2]
      const y0 = shape.wave ? Math.sin(x0 * 4 + wt * 2) * Math.cos(z0 * 3 + wt) * 0.22 : P[o + 1]
      const x1 = x0 * cY - z0 * sY
      const z1 = x0 * sY + z0 * cY
      const y1 = y0 * cX - z1 * sX
      const z2 = y0 * sX + z1 * cX
      const per = 3 / Math.max(1, 3 - z2)
      const gx = x1 * sc * per
      const gy = -y1 * sc * per
      tx[i] = gx
      ty[i] = gy
      if (free) {
        vx[i] = (vx[i] + (gx - px[i]) * k[i]) * 0.84
        vy[i] = (vy[i] + (gy - py[i]) * k[i]) * 0.84
        px[i] += vx[i]
        py[i] += vy[i]
      } else {
        px[i] = gx
        py[i] = gy
        vx[i] = 0
        vy[i] = 0
      }
      depth[i] = Math.min(1, Math.max(0, (z2 + 1) * 0.5))
    }
    this.sc = sc
  }
}
