// Shape builders, ported 1:1 from fx() in design/assetradigital-design-v2.dc.html.
// A shape is N target points normalised to roughly [-1, 1]; `@name` keys are 3D shapes,
// any other key is text sampled from an offscreen canvas.

export interface Shape {
  /** x, y, z per particle */
  p: Float32Array
  /** half extents after normalisation (used to fit flat shapes into the zone) */
  ex: number
  ey: number
  flat: boolean
  text?: boolean
  wave?: boolean
}

type Pt = [number, number, number?]

const rnd = (a: number) => (Math.random() - 0.5) * a

function norm(pts: Pt[], flat: boolean): Shape {
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9
  for (const q of pts) {
    a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0])
    b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1])
  }
  const s = 2 / Math.max(a1 - a0, b1 - b0, 1e-6)
  const ox = (a0 + a1) / 2
  const oy = (b0 + b1) / 2
  const p = new Float32Array(pts.length * 3)
  pts.forEach((q, i) => {
    p[i * 3] = (q[0] - ox) * s
    p[i * 3 + 1] = (q[1] - oy) * s
    p[i * 3 + 2] = (q[2] || 0) * s
  })
  return { p, ex: ((a1 - a0) * s) / 2, ey: ((b1 - b0) * s) / 2, flat }
}

// ~82 % of the points come from letter outlines, the rest fill the strokes.
function fitE(N: number, edge: Pt[], fill: Pt[]): Shape {
  const pick: Pt[] = []
  for (let i = 0; i < N; i++) {
    const src = fill.length && Math.random() > 0.82 ? fill : edge
    const q = src[Math.floor(Math.random() * src.length)]
    pick.push([q[0] + rnd(0.8), q[1] + rnd(0.8), rnd(10)])
  }
  const out = norm(pick, true)
  out.text = true
  return out
}

export function sphere(N: number): Shape {
  const pts: Pt[] = []
  const ga = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const yy = 1 - (i / (N - 1)) * 2
    const rr = Math.sqrt(1 - yy * yy)
    const an = ga * i
    pts.push([Math.cos(an) * rr, yy, Math.sin(an) * rr])
  }
  return norm(pts, false)
}

function torus(N: number): Shape {
  const pts: Pt[] = []
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 6.283
    const v = Math.random() * 6.283
    pts.push([(0.72 + 0.28 * Math.cos(v)) * Math.cos(u), 0.28 * Math.sin(v), (0.72 + 0.28 * Math.cos(v)) * Math.sin(u)])
  }
  return norm(pts, false)
}

function cube(N: number): Shape {
  const pts: Pt[] = []
  for (let i = 0; i < N; i++) {
    const fc = Math.floor(Math.random() * 6)
    const c1 = rnd(1.3)
    const c2 = rnd(1.3)
    const sd = fc % 2 ? 0.65 : -0.65
    pts.push(fc > 3 ? [c1, c2, sd] : fc > 1 ? [c1, sd, c2] : [sd, c1, c2])
  }
  return norm(pts, false)
}

function wave(N: number): Shape {
  const cols = Math.ceil(Math.sqrt(N * 2.2))
  const rows = Math.ceil(N / cols)
  const pts: Pt[] = []
  for (let i = 0; i < N; i++) {
    pts.push([((i % cols) / (cols - 1)) * 2 - 1, 0, (Math.floor(i / cols) / Math.max(1, rows - 1)) * 1.2 - 0.6])
  }
  const out = norm(pts, false)
  out.wave = true
  return out
}

// The AD mark: A and D share one vertical stroke; the last 10 % of points form the mint pixel.
function logo(N: number, lineN: number): Shape {
  const segs = [[3, 29, 20, 3], [20, 3, 20, 29], [20, 3, 25, 3], [25, 29, 20, 29]]
  const lens = segs.map((q) => Math.hypot(q[2] - q[0], q[3] - q[1]))
  const arc = Math.PI * 13
  const tot = lens[0] + lens[1] + lens[2] + lens[3] + arc
  const pts: Pt[] = []
  for (let i = 0; i < N; i++) {
    let lx = 0
    let ly = 0
    if (i >= lineN) {
      lx = 12.6 + Math.random() * 4.6
      ly = 18.2 + Math.random() * 4.6
    } else {
      let rem = Math.random() * tot
      let found = false
      for (let j = 0; j < 4 && !found; j++) {
        if (lens[j] > rem) {
          const q = segs[j]
          const f = rem / lens[j]
          lx = q[0] + (q[2] - q[0]) * f
          ly = q[1] + (q[3] - q[1]) * f
          found = true
        } else {
          rem -= lens[j]
        }
      }
      if (!found) {
        const an = -Math.PI / 2 + (rem / arc) * Math.PI
        lx = 25 + Math.cos(an) * 13
        ly = 16 + Math.sin(an) * 13
      }
      lx += rnd(2.2)
      ly += rnd(2.2)
    }
    pts.push([lx, -ly, rnd(2)])
  }
  return norm(pts, true)
}

// Archivo 800 at normal width with 5 % letter spacing, sampled every 2 px.
function text(N: number, str: string, family: string): Shape {
  const c = document.createElement('canvas')
  const cw = 900
  const chh = 340
  c.width = cw
  c.height = chh
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return sphere(N)
  let fs = 280
  const setF = () => {
    g.font = '800 ' + fs + 'px ' + family
    try {
      g.fontStretch = 'normal'
      g.letterSpacing = Math.round(fs * 0.05) + 'px'
    } catch {
      // older engines lack these canvas properties
    }
  }
  setF()
  const mw = g.measureText(str).width
  if (mw > cw * 0.9) {
    fs = Math.floor((fs * cw * 0.9) / mw)
    setF()
  }
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(str, cw / 2, chh / 2)
  const data = g.getImageData(0, 0, cw, chh).data
  const edge: Pt[] = []
  const fill: Pt[] = []
  const hit = (hx: number, hy: number) => hx >= 0 && hy >= 0 && cw > hx && chh > hy && data[(hy * cw + hx) * 4 + 3] > 128
  for (let yy = 0; yy < chh; yy += 2) {
    for (let xx = 0; xx < cw; xx += 2) {
      if (hit(xx, yy)) {
        if (hit(xx - 4, yy) && hit(xx + 4, yy) && hit(xx, yy - 4) && hit(xx, yy + 4)) fill.push([xx, -yy])
        else edge.push([xx, -yy])
      }
    }
  }
  return edge.length ? fitE(N, edge, fill) : sphere(N)
}

export function isTextKey(key: string) {
  return !['@sphere', '@torus', '@cube', '@wave', '@logo'].includes(key)
}

export function buildShape(key: string, N: number, lineN: number, family: string): Shape {
  switch (key) {
    case '@sphere': return sphere(N)
    case '@torus': return torus(N)
    case '@cube': return cube(N)
    case '@wave': return wave(N)
    case '@logo': return logo(N, lineN)
    default: return text(N, key, family)
  }
}
