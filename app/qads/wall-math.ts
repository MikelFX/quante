// Choreography of the Qads community wall (QadsCommunityWall.tsx) — pure maths, tested in
// __tests__/qads-wall.test.mjs. One progress value q runs the whole scene:
//   0 → 1   the stage scrolls up into view: one strip of media, curved like a 3D carousel and
//           tilted far back, its lower part dissolving into grain at the bottom of the screen;
//   1 → 1.3 the strip straightens and turns toward the viewer into a band;
//   1.2 → 2 the other tiles fly in from every direction and settle into three more rows.
// Positions are in px relative to the stage centre; angles in degrees.

export interface WallLayout {
  cols: number
  rows: number
  /** Row (from the top) the opening strip becomes. */
  strip: number
  tileW: number
  tileH: number
  gap: number
}

export interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number; o: number }

export const ROWS = 4
export const STRIP_ROW = 1
const FLY_FROM = 1.2
const FLY_SPREAD = 0.42
const FLY_FOR = 0.34

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4)

/** Deterministic 0..1 per (tile, channel) — the same scatter on every visit. */
export function rand(i: number, k: number): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Tile grid for a viewport: portrait 3:4 tiles; four rows fit in ~70 % of the height. */
export function wallLayout(W: number, H: number): WallLayout {
  const cols = Math.max(3, Math.min(8, Math.round(W / 210)))
  const gap = W < 720 ? 10 : 16
  const byW = (W * 0.94 - gap * (cols - 1)) / cols
  const byH = ((H * 0.7 - gap * (ROWS - 1)) / ROWS) * 0.75
  const tileW = Math.floor(Math.min(byW, byH, 230))
  return { cols, rows: ROWS, strip: STRIP_ROW, tileW, tileH: Math.round(tileW * (4 / 3)), gap }
}

/** Tiles 0..cols-1 are the strip; the rest fill the other rows in order. */
export function slotOf(i: number, L: WallLayout): { r: number; c: number; x: number; y: number } {
  let r: number
  let c: number
  if (i < L.cols) {
    r = L.strip
    c = i
  } else {
    const k = i - L.cols
    const other = Math.floor(k / L.cols)
    r = other < L.strip ? other : other + 1
    c = k % L.cols
  }
  return {
    r,
    c,
    x: (c - (L.cols - 1) / 2) * (L.tileW + L.gap),
    y: (r - (L.rows - 1) / 2) * (L.tileH + L.gap),
  }
}

/** When tile i has finished flying in (q); strip tiles are there from the start. */
export function landedAt(i: number, L: WallLayout): number {
  return i < L.cols ? 0 : FLY_FROM + rand(i, 1) * FLY_SPREAD + FLY_FOR
}

/** The whole wall: how far it is tilted back, where it sits, how large. */
export function groupPose(q: number, L: WallLayout, H: number): { y: number; tilt: number; scale: number } {
  const open = easeInOut(clamp01(q / 1.3))
  const settle = easeInOut(clamp01((q - 1.65) / 0.35))
  const stripY = slotOf(0, L).y
  // At first the strip sits near the top of the stage; in the end the four rows fill the stage.
  const startY = -H / 2 + L.tileH * 0.55 - stripY
  // In the end the wall sits a little low, leaving room for the heading above it.
  return {
    y: lerp(startY, H * 0.1, open),
    tilt: lerp(lerp(44, 12, open), 5, settle),
    scale: lerp(1.08, 1, open),
  }
}

export function tilePose(i: number, L: WallLayout, q: number, W: number, H: number): Pose {
  const slot = slotOf(i, L)
  if (i < L.cols) {
    // The strip: a curved carousel that straightens out into a flat band.
    const bend = 1 - easeInOut(clamp01(q / 1.25))
    const off = slot.c - (L.cols - 1) / 2
    return { x: slot.x, y: slot.y, z: -off * off * 26 * bend, rx: 0, ry: -off * 11 * bend, rz: 0, s: 1, o: 1 }
  }
  const start = FLY_FROM + rand(i, 1) * FLY_SPREAD
  const t = clamp01((q - start) / FLY_FOR)
  if (t <= 0) return { x: slot.x, y: slot.y, z: -3000, rx: 0, ry: 0, rz: 0, s: 0.5, o: 0 }
  const e = easeOutQuart(t)
  const ang = rand(i, 2) * Math.PI * 2
  const dist = Math.max(W, H) * (1.05 + rand(i, 3) * 0.6)
  return {
    x: lerp(Math.cos(ang) * dist, slot.x, e),
    y: lerp(Math.sin(ang) * dist * 0.75, slot.y, e),
    z: lerp(-900 + rand(i, 4) * 1500, 0, e),
    rx: lerp((rand(i, 5) - 0.5) * 150, 0, e),
    ry: lerp((rand(i, 6) - 0.5) * 170, 0, e),
    rz: lerp((rand(i, 7) - 0.5) * 100, 0, e),
    s: lerp(0.55 + rand(i, 8) * 0.7, 1, e),
    o: clamp01(t * 3.5),
  }
}

/**
 * Fill `count` tiles: shared creations first (newest), then the seed, repeating the pool. With
 * `cols`, each row starts three pieces further on, so a repeat never sits right below itself.
 */
export function fillWall<T>(community: T[], seed: T[], count: number, cols = count): T[] {
  const pool = [...community, ...seed]
  if (!pool.length) return []
  return Array.from({ length: count }, (_, i) => pool[((i % cols) + Math.floor(i / cols) * 3) % pool.length])
}
