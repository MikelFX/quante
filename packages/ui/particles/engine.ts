// The particle engine. It began as a 1:1 port of fx() from design/assetradigital-design-v2.dc.html
// (particles() in that file is an older, unused version and is intentionally not ported).
//
// Two layers:
// • The fixed background canvas, 'site' mode only: a dot grid that scrolls with the page and carries
//   ripples (ripples.ts). The mouse glows magenta and leaves a wake of rings as it moves across the
//   page (also when the page scrolls under it), a click drops a stone in, a resting mouse sends a
//   soft pulse; crests tint the dots magenta, troughs lilac, and the dots shift along the rings. Only a
//   mouse makes waves: on touch screens they looked wrong (owner, 2026-10-12). A light band sweeps
//   down the page and (on desktop) a dotted path with a running signal links the zones.
// • One formation per <ParticleZone> (formation.ts), drawn into the zone's own canvas, so it scrolls
//   with the page exactly. Owner, 2026-10-12: a formation stays on its place. It turns, sways and
//   changes shape every 4.8 s there, but never flies to another zone, and neither the mouse nor a
//   finger moves it. Only formations near the viewport are simulated; one that comes back into view
//   is already formed.
// 'app' mode draws only the formations.

import { buildShape, isTextKey, type Shape } from './shapes'
import { particleStore } from './store'
import { Ripples, ripplesFrom } from './ripples'
import { Formation, canvasPad } from './formation'

/** Ripple look: dot shift (px per unit), and the height range that fades a dot from grey to colour. */
const RIPPLE_SHIFT = 9
const RIPPLE_FROM = 0.03
const RIPPLE_FULL = 0.5
/** Mouse wake: one ring per this many px of travel across the page. */
const WAKE_STEP = 34
/** Dots are batched by colour and one of this many opacity steps (one fillStyle each). */
const ALPHA_STEPS = 16

const CYCLE_MS = 4800
const MAX_VIEWPORT_H = 2200
const FALLBACK_FAMILY = 'Archivo, "Arial Narrow", sans-serif'
/** Formations this close to the viewport are kept drawn, so they are formed before they scroll in. */
const NEAR = '200px 0px'
/** A formation that first appears on screen fades in over this long, ms. */
const FADE_IN = 600
/** Dots fade out within this many px of their canvas edge, so an overshoot never ends in a hard cut. */
const EDGE_FADE = 14

interface ZoneState {
  el: HTMLElement
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  keys: string[]
  floating: boolean
  form: Formation
  idx: number
  next: number
  /** In or near the viewport (IntersectionObserver). */
  near: boolean
  w: number
  h: number
  /** Drawn in the previous frame; when it comes back it starts formed. */
  live: boolean
  /** When it first appeared on screen (fade-in); -1 = no fade, null = not drawn yet. */
  born: number | null
  /** With animations off: what was drawn last, so it is redrawn only when something changed. */
  sig: string
  shape: Shape | null
}

function motionAllowed(reduced: MediaQueryList) {
  return document.documentElement.getAttribute('data-motion') !== 'off' && !reduced.matches
}

function displayFamily(el: Element | null) {
  if (!el) return FALLBACK_FAMILY
  const v = getComputedStyle(el).getPropertyValue('--font-archivo').trim()
  return v ? v + ', "Arial Narrow", sans-serif' : FALLBACK_FAMILY
}

/** Fills the queued squares (x, y, size triples), one fillStyle per batch. */
function flush(g: CanvasRenderingContext2D, batches: number[][], styles: string[]) {
  for (let b = 0; b < batches.length; b++) {
    const list = batches[b]
    if (!list.length) continue
    g.fillStyle = styles[b]
    for (let q = 0; q < list.length; q += 3) {
      const sz = list[q + 2]
      g.fillRect(list[q] - sz / 2, list[q + 1] - sz / 2, sz, sz)
    }
  }
}

function styleSteps(rgbs: string[]) {
  const out: string[] = []
  for (const rgb of rgbs) for (let q = 0; q <= ALPHA_STEPS; q++) out.push('rgba(' + rgb + ',' + (q / ALPHA_STEPS).toFixed(3) + ')')
  return out
}

export function startParticles(cv: HTMLCanvasElement): () => void {
  const ctx = cv.getContext('2d')
  if (!ctx) return () => {}

  const offs: Array<() => void> = []
  const listen = <K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(type, fn, opts)
    offs.push(() => t.removeEventListener(type, fn, opts))
  }

  let W = 0
  let H = 0
  let dpr = 1
  let tooTall = false
  let raf = 0
  let lastSig = ''
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = window.innerWidth
    H = window.innerHeight
    tooTall = H > MAX_VIEWPORT_H
    cv.style.display = tooTall ? 'none' : ''
    lastSig = ''
  }
  resize()

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const small = window.innerWidth < 760
  const N = small ? 1300 : 1800
  const lineN = N - Math.floor(N * 0.1)

  // Shapes are cached per key; text shapes are rebuilt once the display font has loaded.
  const cache = new Map<string, Shape>()
  let family = FALLBACK_FAMILY
  const shapeFor = (key: string) => {
    let s = cache.get(key)
    if (!s) {
      s = buildShape(key, N, lineN, family)
      cache.set(key, s)
    }
    return s
  }
  const refreshFamily = (el: Element | null) => {
    const f = displayFamily(el)
    if (f === family) return
    family = f
    for (const k of [...cache.keys()]) if (isTextKey(k)) cache.delete(k)
    if (document.fonts && document.fonts.load) {
      document.fonts.load('800 100px ' + f).then(() => {
        for (const k of [...cache.keys()]) if (isTextKey(k)) cache.delete(k)
      }, () => {})
    }
  }

  // ── formations ─────────────────────────────────────────────────────────
  const states = new Map<HTMLElement, ZoneState>()
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = states.get(e.target as HTMLElement)
        if (s) s.near = e.isIntersecting
      }
    }, { rootMargin: NEAR })
    : null
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      for (const e of entries) {
        const s = states.get(e.target as HTMLElement)
        if (s) {
          s.w = s.el.clientWidth
          s.h = s.el.clientHeight
        }
      }
    })
    : null

  /** Frees the canvas memory; the formation is drawn again (formed) when it comes back. */
  const release = (s: ZoneState) => {
    s.cv.width = 0
    s.cv.height = 0
    s.live = false
    s.sig = ''
  }
  const drop = (s: ZoneState) => {
    io?.unobserve(s.el)
    ro?.unobserve(s.el)
    release(s)
    states.delete(s.el)
  }

  // Zones change while React commits; they are matched up at the start of the next frame, so a zone
  // that only swaps its shapes (the Qgent header: logo ↔ AGENT) keeps its dots and changes in place.
  let zonesDirty = true
  offs.push(particleStore.subscribeZones(() => { zonesDirty = true }))
  const reconcile = (now: number) => {
    zonesDirty = false
    const zones = particleStore.getZones()
    const seen = new Set<HTMLElement>()
    for (const z of zones) {
      seen.add(z.el)
      let s = states.get(z.el)
      if (s && s.cv !== z.canvas) {
        drop(s)
        s = undefined
      }
      if (!s) {
        s = {
          el: z.el, cv: z.canvas, ctx: z.canvas.getContext('2d'), keys: z.keys, floating: z.floating,
          form: new Formation(N), idx: 0, next: 0, near: !io, w: 0, h: 0, live: false, born: null, sig: '', shape: null,
        }
        states.set(z.el, s)
        io?.observe(z.el)
        ro?.observe(z.el)
        continue
      }
      s.floating = z.floating
      if (s.keys.join('|') !== z.keys.join('|')) {
        s.keys = z.keys
        s.idx = 0
        s.next = now + CYCLE_MS
        s.form.burst(1.5)
      }
    }
    for (const s of [...states.values()]) if (!seen.has(s.el)) drop(s)
    if (zones.length) refreshFamily(zones[0].el)
    lastSig = ''
  }

  // ── mouse (background only) ────────────────────────────────────────────
  let mp: { x: number; y: number } | null = null
  // Ripples on the dot grid (page coordinates).
  const ripples = new Ripples()
  // Ripple heights / shifts on a lattice at half the dot spacing (dots sit on odd cells).
  let latH = new Float32Array(0)
  let latDX = new Float32Array(0)
  let latDY = new Float32Array(0)
  // Coloured grid dots per [tint][opacity step], and formation dots per [grey | accent][opacity step]:
  // x, y, size triples, reused every frame.
  const batches: number[][] = Array.from({ length: 2 * (ALPHA_STEPS + 1) }, () => [])
  const dots: number[][] = Array.from({ length: 2 * (ALPHA_STEPS + 1) }, () => [])
  let batchStyles: string[] = []
  let dotStyles: string[] = []
  let theme = ''
  let lastP: { x: number; y: number } | null = null // mouse in page coordinates
  let wakeLeft = 0 // px of travel until the next wake ring
  let lastMoveT = 0
  let nextPulse = 0
  const taps: { x: number; y: number }[] = []
  listen(window, 'pointermove', (e) => {
    if (ripplesFrom(e.pointerType)) mp = { x: e.clientX, y: e.clientY }
  }, { passive: true })
  listen(window, 'pointerdown', (e) => {
    if (!ripplesFrom(e.pointerType) || particleStore.getMode() !== 'site') return
    taps.push({ x: e.clientX, y: e.clientY })
    if (taps.length > 4) taps.shift()
  }, { passive: true })
  const onOut = (e: MouseEvent) => { if (!e.relatedTarget) mp = null }
  document.addEventListener('mouseout', onOut)
  offs.push(() => document.removeEventListener('mouseout', onOut))
  listen(window, 'resize', resize)

  // ── background ─────────────────────────────────────────────────────────
  const drawBackground = (now: number, T: number, on: boolean, dark: boolean, accRGB: string, acc2RGB: string, baseRGB: string) => {
    if (particleStore.getMode() !== 'site' || tooTall) {
      // Nothing to draw: free the canvas. No wake across the gap either.
      if (cv.width) {
        cv.width = 0
        cv.height = 0
      }
      lastP = null
      taps.length = 0
      ripples.clear()
      lastSig = ''
      return
    }
    const bw = Math.round(W * dpr)
    const bh = Math.round(H * dpr)
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw
      cv.height = bh
      lastSig = ''
    }
    const rt = -window.scrollY
    const m = mp
    const zones = particleStore.getZones()

    // With animations off, redraw only when something visible changed.
    if (!on) {
      const sig = [W, H, rt, dark, zones.length, m ? m.x + ',' + m.y : ''].join('|')
      if (sig === lastSig) return
      lastSig = sig
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const gap = small ? 26 : 30
    const offY = ((rt % gap) + gap) % gap

    if (on) {
      if (m) {
        // Wake: rings along the mouse's path across the page since the last frame (also the page
        // scrolling under a still mouse). Faster = stronger, capped.
        const py = m.y - rt
        if (lastP) {
          const dx = m.x - lastP.x
          const dy = py - lastP.y
          const dist = Math.hypot(dx, dy)
          if (dist > 0.5) {
            lastMoveT = now
            if (dist < 700) {
              const a = Math.min(0.5, 0.18 + dist * 0.012)
              let along = wakeLeft
              while (along <= dist) {
                const f = along / dist
                ripples.add(lastP.x + dx * f, lastP.y + dy * f, now, a, 560)
                along += WAKE_STEP
              }
              wakeLeft = along - dist
            }
          }
        }
        lastP = { x: m.x, y: py }
        // A resting mouse breathes: a soft ring from the cursor every few seconds.
        if (now - lastMoveT < 700) nextPulse = Math.max(nextPulse, now + 1000)
        else if (now > nextPulse) {
          ripples.add(m.x, py, now, 0.5, 1300)
          nextPulse = now + 2800
        }
      } else {
        lastP = null
      }
      for (const t of taps) ripples.add(t.x, t.y - rt, now, 1.1, 1500)
      taps.length = 0
      ripples.prune(now)
    } else {
      taps.length = 0
      lastP = null
      ripples.clear()
    }

    const bandY = on ? ((T * 140) % (H + 300)) - 150 : -999
    const calm = !on || ripples.empty
    const half = gap / 2
    const ly0 = offY - half // screen y of lattice row 0
    const lc = Math.ceil(W / half) + 2
    const lr = Math.ceil((H + gap) / half) + 2
    if (!calm) {
      if (latH.length !== lc * lr) {
        latH = new Float32Array(lc * lr)
        latDX = new Float32Array(lc * lr)
        latDY = new Float32Array(lc * lr)
      }
      ripples.accumulate(now, 0, ly0 - rt, half, lc, lr, latH, latDX, latDY)
    }
    for (const list of batches) list.length = 0
    const addDot = (x: number, y: number, size: number, tint: number, alpha: number) => {
      const q = Math.min(ALPHA_STEPS, Math.max(1, Math.round(alpha * ALPHA_STEPS)))
      batches[tint * (ALPHA_STEPS + 1) + q].push(x, y, size)
    }

    ctx.fillStyle = 'rgba(' + baseRGB + ',' + (dark ? '0.08' : '0.1') + ')'
    for (let gy = offY, j = 1; H > gy; gy += gap, j += 2) {
      for (let gx = half, i = 1; W > gx; gx += gap, i += 2) {
        let px = gx
        let py = gy
        let w = 0
        let tint = 0
        if (!calm) {
          const idx = j * lc + i
          const hv = latH[idx]
          px += latDX[idx] * RIPPLE_SHIFT
          py += latDY[idx] * RIPPLE_SHIFT
          const ah = hv < 0 ? -hv : hv
          if (ah > RIPPLE_FROM) w = Math.min(1, (ah - RIPPLE_FROM) / (RIPPLE_FULL - RIPPLE_FROM))
          tint = hv < 0 ? 1 : 0
        }
        // The magenta glow around the mouse.
        let k = 0
        if (m) {
          const dx = gx - m.x
          const dy = gy - m.y
          const d2 = dx * dx + dy * dy
          if (25600 > d2) k = 1 - Math.sqrt(d2) / 160
        }
        const db = Math.abs(gy - bandY)
        if (60 > db) k = Math.max(k, (1 - db / 60) * 0.35)
        const kk = w > k ? w : k
        if (kk > 0.02) {
          const t = w > k ? tint : 0
          // Troughs (blue) a touch softer than crests, so the rings read as light on dark water.
          addDot(px, py, 1.5 + kk * 2.6, t, (0.12 + kk * 0.62) * (t ? 0.8 : 1))
        } else {
          ctx.fillRect(px - 0.75, py - 0.75, 1.5, 1.5)
        }
      }
    }
    // Where a wave is passing, fill in the cells between the dots so the rings read as smooth
    // circles; everywhere else the grid stays sparse.
    if (!calm) {
      for (let j = 0; j < lr; j++) {
        const row = j * lc
        const y = ly0 + j * half
        for (let i = 0; i < lc; i++) {
          if (i & 1 && j & 1) continue // a regular grid dot
          const hv = latH[row + i]
          const ah = hv < 0 ? -hv : hv
          if (ah < 0.12) continue
          const w = Math.min(1, (ah - 0.12) / 0.4)
          addDot(i * half + latDX[row + i] * RIPPLE_SHIFT, y + latDY[row + i] * RIPPLE_SHIFT, 1 + w * 1.6, hv < 0 ? 1 : 0, w * (hv < 0 ? 0.42 : 0.55))
        }
      }
    }
    flush(ctx, batches, batchStyles)

    if (!small) {
      const cs: [number, number][] = []
      for (const z of zones) {
        if (z.floating) continue
        const r = z.el.getBoundingClientRect()
        if (r.width > 0) cs.push([r.left + r.width / 2, r.top + r.height / 2])
      }
      for (let j = 0; cs.length - 1 > j; j++) {
        const A = cs[j]
        const B = cs[j + 1]
        if (A[1] > H + 200 || -200 > B[1]) continue
        const steps = Math.max(2, Math.floor(Math.hypot(B[0] - A[0], B[1] - A[1]) / 14))
        ctx.fillStyle = 'rgba(' + baseRGB + ',0.2)'
        for (let s = 0; steps >= s; s++) {
          const f = s / steps
          const e1 = f * f * (3 - 2 * f)
          const x = A[0] + (B[0] - A[0]) * e1
          const y = A[1] + (B[1] - A[1]) * f
          if (y > -10 && H + 10 > y) ctx.fillRect(x - 1, y - 1, 2, 2)
        }
        if (on) {
          const f = (T * 0.22 + j * 0.37) % 1
          const e1 = f * f * (3 - 2 * f)
          const x = A[0] + (B[0] - A[0]) * e1
          const y = A[1] + (B[1] - A[1]) * f
          ctx.fillStyle = 'rgba(' + accRGB + ',0.9)'
          ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
        }
      }
    }
  }

  // ── one formation ──────────────────────────────────────────────────────
  const drawZone = (s: ZoneState, now: number, T: number, on: boolean, dark: boolean, baseRGB: string) => {
    if (!ro) {
      s.w = s.el.clientWidth
      s.h = s.el.clientHeight
    }
    const g = s.ctx
    if (!s.near || !g || s.w < 1 || s.h < 1) {
      if (s.live) release(s)
      return
    }

    // The canvas covers the zone plus the room its shapes reach past it.
    const pad = canvasPad(s.keys, s.w, s.h)
    const cw = s.w + pad.x * 2
    const ch = s.h + pad.y * 2
    const bw = Math.round(cw * dpr)
    const bh = Math.round(ch * dpr)
    if (s.cv.width !== bw || s.cv.height !== bh) {
      s.cv.width = bw
      s.cv.height = bh
      const st = s.cv.style
      st.left = -pad.x + 'px'
      st.top = -pad.y + 'px'
      st.width = cw + 'px'
      st.height = ch + 'px'
      s.sig = ''
    }

    // Coming (back) into view: already formed, the current shape gets a full turn.
    const snap = !s.live
    if (snap) {
      s.live = true
      s.next = now + CYCLE_MS
      if (s.born === null) {
        const r = s.el.getBoundingClientRect()
        s.born = on && r.bottom > 0 && H > r.top ? now : -1
      }
    }
    if (on && now > s.next) {
      s.idx = (s.idx + 1) % s.keys.length
      s.next = now + CYCLE_MS
      s.form.burst(1.5)
    }
    const shape = shapeFor(s.keys[s.idx % s.keys.length])
    if (!on) {
      const sig = bw + 'x' + bh + '|' + dark + '|' + s.idx
      if (sig === s.sig && shape === s.shape && !snap) return
      s.sig = sig
    } else {
      s.sig = ''
    }
    s.shape = shape

    const F = s.form
    F.step(shape, T, s.w, s.h, on, snap)

    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, cw, ch)
    // Animations switched off mid fade-in: show it whole (it is only redrawn when something changes).
    if (!on) s.born = -1
    const born = s.born ?? -1
    g.globalAlpha = born < 0 ? 1 : Math.min(1, (now - born) / FADE_IN)
    if (born >= 0 && now - born >= FADE_IN) s.born = -1
    const ox = pad.x + s.w / 2
    const oy = pad.y + s.h / 2
    for (const list of dots) list.length = 0
    for (let i = 0; i < N; i++) {
      const x = ox + F.px[i]
      const y = oy + F.py[i]
      let e = x < y ? x : y
      if (cw - x < e) e = cw - x
      if (ch - y < e) e = ch - y
      if (e <= 0) continue
      const d = F.depth[i]
      const accent = i >= lineN
      let al = accent ? 0.6 + d * 0.4 : 0.14 + d * 0.6
      if (e < EDGE_FADE) al *= e / EDGE_FADE
      const q = Math.min(ALPHA_STEPS, Math.round(al * ALPHA_STEPS))
      if (q < 1) continue
      dots[(accent ? ALPHA_STEPS + 1 : 0) + q].push(x, y, (accent ? 2 : 1.2) + d * 1.4)
    }
    flush(g, dots, dotStyles)

    // Words only link points that are close (16 px mobile / 20 px desktop). 3D shapes link up to
    // 44 / 60 px, less when the shape is drawn small (the Qgent panel header) so it doesn't turn
    // into a solid blob.
    const M = shape.text ? (small ? 240 : 320) : small ? 110 : 170
    const th = shape.text ? (small ? 16 : 20) : Math.min(small ? 44 : 60, F.sc * 0.45)
    g.lineWidth = 1
    g.strokeStyle = 'rgba(' + baseRGB + ',' + (shape.text ? '0.28' : '0.12') + ')'
    g.beginPath()
    for (let i = 0; M > i; i++) {
      for (let j = i + 1; M > j; j++) {
        const dx = F.px[i] - F.px[j]
        const dy = F.py[i] - F.py[j]
        if (th * th > dx * dx + dy * dy) {
          g.moveTo(ox + F.px[i], oy + F.py[i])
          g.lineTo(ox + F.px[j], oy + F.py[j])
        }
      }
    }
    g.stroke()
    g.globalAlpha = 1
  }

  // ── frame ──────────────────────────────────────────────────────────────
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!W || !H) return
    if (zonesDirty) reconcile(now)
    const on = motionAllowed(reduced)
    const dark = document.documentElement.getAttribute('data-theme') !== 'light'
    const T = now * 0.001
    const accRGB = dark ? '255,90,210' : '196,38,172'
    const acc2RGB = dark ? '193,155,255' : '154,108,240'
    const baseRGB = dark ? '242,238,240' : '20,18,21'
    if (theme !== accRGB + acc2RGB + baseRGB) {
      theme = accRGB + acc2RGB + baseRGB
      batchStyles = styleSteps([accRGB, acc2RGB])
      dotStyles = styleSteps([baseRGB, accRGB])
    }
    drawBackground(now, T, on, dark, accRGB, acc2RGB, baseRGB)
    for (const s of states.values()) drawZone(s, now, T, on, dark, baseRGB)
  }

  // Paused while the tab is hidden.
  const run = () => {
    cancelAnimationFrame(raf)
    if (!document.hidden) raf = requestAnimationFrame(frame)
  }
  const onVis = () => run()
  document.addEventListener('visibilitychange', onVis)
  offs.push(() => document.removeEventListener('visibilitychange', onVis))
  run()

  return () => {
    cancelAnimationFrame(raf)
    io?.disconnect()
    ro?.disconnect()
    for (const s of states.values()) release(s)
    states.clear()
    offs.forEach((off) => off())
    cv.width = 0
    cv.height = 0
  }
}
