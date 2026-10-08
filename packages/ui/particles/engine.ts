// The particle engine: a 1:1 port of fx() from design/assetradigital-design-v2.dc.html
// (particles() in that file is an older, unused version and is intentionally not ported).
//
// One fixed canvas behind the content. The zone nearest the viewport centre is active and the
// swarm flies into it and forms its shape; shapes rotate every 4.8 s, a tap bursts the swarm into
// the next shape, a drag spins it. In 'site' mode a dot grid scrolls with the page and carries
// ripples (ripples.ts): the pointer glows green and leaves a wake of rings as it moves across the
// page (also when the page scrolls under it), a tap drops a stone in, a resting pointer sends a
// soft pulse; crests tint the dots mint, troughs blue, and the dots shift along the rings. A light
// band sweeps down the page and (on desktop) a dotted path with a running signal links the zones.
// 'app' mode draws only the zones.
//
// A priority zone (the open Qgent panel) sits on a glass panel that would blur the swarm, so
// while it is active the canvas is lifted above the panel (OVERLAY_Z), draws nothing but the
// swarm and clips it to the zone. Everything goes back when the panel closes.

import { buildShape, isTextKey, type Shape } from './shapes'
import { particleStore, type ZoneRecord } from './store'
import { Ripples } from './ripples'

/** Ripple look: dot shift (px per unit), and the height range that fades a dot from grey to colour. */
const RIPPLE_SHIFT = 9
const RIPPLE_FROM = 0.03
const RIPPLE_FULL = 0.5
/** Pointer wake: one ring per this many px of travel across the page. */
const WAKE_STEP = 34
/** Coloured dots are batched by colour and one of this many opacity steps (one fillStyle each). */
const ALPHA_STEPS = 16

const CYCLE_MS = 4800
const MAX_VIEWPORT_H = 2200
const FALLBACK_FAMILY = 'Archivo, "Arial Narrow", sans-serif'
/** Above the Qgent panel (z 70), below the custom cursor (z 80). */
const OVERLAY_Z = '75'

interface ZoneState {
  idx: number
  next: number
  cleanup: () => void
}

function motionAllowed(reduced: MediaQueryList) {
  return document.documentElement.getAttribute('data-motion') !== 'off' && !reduced.matches
}

function displayFamily(el: Element | null) {
  if (!el) return FALLBACK_FAMILY
  const v = getComputedStyle(el).getPropertyValue('--font-archivo').trim()
  return v ? v + ', "Arial Narrow", sans-serif' : FALLBACK_FAMILY
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
  let raised = false
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    W = window.innerWidth
    H = window.innerHeight
    tooTall = H > MAX_VIEWPORT_H
    cv.style.display = tooTall ? 'none' : ''
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    lastSig = ''
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const fine = window.matchMedia('(hover: hover)').matches
  const small = window.innerWidth < 760
  const N = small ? 1300 : 1800
  const lineN = N - Math.floor(N * 0.1)
  const rnd = (a: number) => (Math.random() - 0.5) * a

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

  const px = new Float32Array(N)
  const py = new Float32Array(N)
  const vx = new Float32Array(N)
  const vy = new Float32Array(N)
  const kk = new Float32Array(N)
  resize()
  for (let i = 0; i < N; i++) {
    px[i] = Math.random() * W
    py[i] = Math.random() * H
    kk[i] = 0.02 + Math.random() * 0.035
  }
  const burst = (f: number) => {
    for (let i = 0; i < N; i++) {
      vx[i] += rnd(f * 2)
      vy[i] += rnd(f * 2)
    }
  }

  // ── zones ──────────────────────────────────────────────────────────────
  let active: ZoneRecord | null = null
  let drag = 0
  let isDown = false
  let downX = 0
  let moved = 0
  const state = new Map<number, ZoneState>()
  const zs = (z: ZoneRecord) => state.get(z.id)!

  const syncZones = () => {
    const zones = particleStore.getZones()
    const ids = new Set(zones.map((z) => z.id))
    for (const [id, s] of state) {
      if (!ids.has(id)) {
        s.cleanup()
        state.delete(id)
      }
    }
    for (const z of zones) {
      if (state.has(z.id)) continue
      const onDown = (e: PointerEvent) => {
        isDown = true
        downX = e.clientX
        moved = 0
      }
      const onClick = () => {
        if (moved > 10 || active !== z) return
        const s = zs(z)
        s.idx = (s.idx + 1) % z.keys.length
        s.next = performance.now() + CYCLE_MS
        burst(7)
      }
      z.el.addEventListener('pointerdown', onDown)
      z.el.addEventListener('click', onClick)
      state.set(z.id, {
        idx: 0,
        next: 0,
        cleanup: () => {
          z.el.removeEventListener('pointerdown', onDown)
          z.el.removeEventListener('click', onClick)
        },
      })
    }
    if (active && !ids.has(active.id)) active = null
    if (zones.length) refreshFamily(zones[0].el)
    lastSig = ''
  }
  syncZones()
  offs.push(particleStore.subscribeZones(syncZones))

  // ── pointer ────────────────────────────────────────────────────────────
  let mp: { x: number; y: number; t: number } | null = null
  // Ripples on the dot grid (page coordinates).
  const ripples = new Ripples()
  // Ripple heights / shifts on a lattice at half the dot spacing (dots sit on odd cells).
  let latH = new Float32Array(0)
  let latDX = new Float32Array(0)
  let latDY = new Float32Array(0)
  // Coloured dots per [tint][opacity step]: x, y, size triples, reused every frame.
  const batches: number[][] = Array.from({ length: 2 * (ALPHA_STEPS + 1) }, () => [])
  let batchStyles: string[] = []
  let batchTheme = ''
  let lastP: { x: number; y: number } | null = null // pointer in page coordinates
  let wakeLeft = 0 // px of travel until the next wake ring
  let lastMoveT = 0
  let nextPulse = 0
  const taps: { x: number; y: number }[] = []
  listen(window, 'pointermove', (e) => {
    mp = { x: e.clientX, y: e.clientY, t: performance.now() }
    if (isDown) {
      const dx = e.clientX - downX
      downX = e.clientX
      moved += Math.abs(dx)
      drag += dx * 0.01
    }
  }, { passive: true })
  listen(window, 'pointerup', () => { isDown = false })
  listen(window, 'pointerdown', (e) => {
    if (particleStore.getMode() !== 'site') return
    taps.push({ x: e.clientX, y: e.clientY })
    if (taps.length > 4) taps.shift()
  }, { passive: true })
  const onOut = (e: MouseEvent) => { if (!e.relatedTarget) mp = null }
  document.addEventListener('mouseout', onOut)
  offs.push(() => document.removeEventListener('mouseout', onOut))
  listen(window, 'resize', resize)

  // ── frame ──────────────────────────────────────────────────────────────
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (!W || !H || tooTall) return
    const mode = particleStore.getMode()
    const site = mode === 'site'
    const on = motionAllowed(reduced)
    const dark = document.documentElement.getAttribute('data-theme') !== 'light'
    const T = now * 0.001
    const rt = -window.scrollY
    const m = mp && (fine || now - mp.t < 2500) ? mp : null

    const zones = particleStore.getZones()
    const rects = zones.map((z) => z.el.getBoundingClientRect())
    let best: ZoneRecord | null = null
    let bestD = 1e9
    for (let j = 0; j < zones.length; j++) {
      const z = zones[j]
      const r = rects[j]
      if (!(r.bottom > 0 && H > r.top && r.width > 0)) continue
      if (z.priority) { best = z; bestD = -1; continue }
      if (bestD < 0) continue
      const d = Math.abs(r.top + r.height / 2 - H / 2)
      if (bestD > d) { bestD = d; best = z }
    }
    // A hidden priority zone never keeps the swarm (or the lifted canvas).
    if (active && active.priority && best !== active) active = null
    if (best && best !== active) {
      active = best
      zs(active).next = now + CYCLE_MS
      if (on) burst(2.5)
    }
    const overlay = !!active && active.priority
    if (overlay !== raised) {
      raised = overlay
      cv.style.zIndex = overlay ? OVERLAY_Z : '0'
    }

    // With animations off, redraw only when something visible changed.
    if (!on) {
      const a = active ? zs(active) : null
      const sig = [W, H, rt, dark, mode, raised, active?.id, a?.idx, m ? m.x + ',' + m.y : '', zones.length].join('|')
      if (sig === lastSig) return
      lastSig = sig
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const accRGB = dark ? '95,245,196' : '5,150,105'
    const acc2RGB = dark ? '124,200,255' : '74,158,234'
    const baseRGB = dark ? '238,242,240' : '11,13,12'

    // No wake across a jump (the grid was hidden behind the Qgent panel or another mode).
    if (!site || raised) lastP = null
    if (site && !raised) {
      const gap = small ? 26 : 30
      const offY = ((rt % gap) + gap) % gap

      if (on) {
        if (m) {
          // Wake: rings along the pointer's path across the page since the last frame (also the
          // page scrolling under a still pointer). Faster = stronger, capped.
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
          else if (fine && now > nextPulse) {
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
      const theme = accRGB + acc2RGB
      if (theme !== batchTheme) {
        batchTheme = theme
        batchStyles = []
        for (const rgb of [accRGB, acc2RGB]) for (let q = 0; q <= ALPHA_STEPS; q++) batchStyles.push('rgba(' + rgb + ',' + (q / ALPHA_STEPS).toFixed(3) + ')')
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
          // The green glow around the pointer.
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
      for (let bI = 0; bI < batches.length; bI++) {
        const list = batches[bI]
        if (!list.length) continue
        ctx.fillStyle = batchStyles[bI]
        for (let q = 0; q < list.length; q += 3) {
          const sz = list[q + 2]
          ctx.fillRect(list[q] - sz / 2, list[q + 1] - sz / 2, sz, sz)
        }
      }

      if (!small) {
        const cs: [number, number][] = []
        zones.forEach((z, j) => {
          const r = rects[j]
          if (!z.priority && r.width > 0) cs.push([r.left + r.width / 2, r.top + r.height / 2])
        })
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

    if (!active) return
    const ai = zones.indexOf(active)
    if (ai < 0) return
    const ar = rects[ai]
    // App mode stays quiet: nothing is drawn while its zone is off screen.
    if (!site && !(ar.bottom > 0 && H > ar.top && ar.width > 0)) return

    if (raised) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(ar.left, ar.top, ar.width, ar.height)
      ctx.clip()
    }

    const st = zs(active)
    if (on && now > st.next) {
      st.idx = (st.idx + 1) % active.keys.length
      st.next = now + CYCLE_MS
      burst(1.5)
    }
    const shape = shapeFor(active.keys[st.idx % active.keys.length])
    const zx = ar.left + ar.width / 2
    const zy = ar.top + ar.height / 2
    const flat = shape.flat
    const sc = flat
      ? Math.min((ar.width * 0.46) / Math.max(shape.ex, 0.01), (ar.height * 0.44) / Math.max(shape.ey, 0.01))
      : Math.min(ar.width, ar.height) * 0.4
    if (!isDown) drag *= 0.95
    const mx = m ? Math.max(-0.5, Math.min(0.5, (m.x - zx) / Math.max(ar.width, 1))) : 0
    const rotY = flat
      ? (on ? Math.sin(T * 0.6) * (shape.text ? 0.14 : 0.32) : 0) + mx * (shape.text ? 0.3 : 0.6) + drag
      : (on ? T * 0.5 : 0.6) + drag
    const rotX = flat ? (on ? Math.sin(T * 0.45) * 0.12 : 0) : 0.35 + (on ? Math.sin(T * 0.3) * 0.15 : 0)
    const cY = Math.cos(rotY)
    const sY = Math.sin(rotY)
    const cX = Math.cos(rotX)
    const sX = Math.sin(rotX)
    const P = shape.p
    for (let i = 0; i < N; i++) {
      const o = i * 3
      const x0 = P[o]
      const z0 = P[o + 2]
      const y0 = shape.wave ? Math.sin(x0 * 4 + T * 2) * Math.cos(z0 * 3 + T) * 0.22 : P[o + 1]
      const x1 = x0 * cY - z0 * sY
      const z1 = x0 * sY + z0 * cY
      const y1 = y0 * cX - z1 * sX
      const z2 = y0 * sX + z1 * cX
      const per = 3 / Math.max(1, 3 - z2)
      const tx = zx + x1 * sc * per
      const ty = zy - y1 * sc * per
      if (on) {
        vx[i] = (vx[i] + (tx - px[i]) * kk[i]) * 0.84
        vy[i] = (vy[i] + (ty - py[i]) * kk[i]) * 0.84
        if (m) {
          const dx = px[i] - m.x
          const dy = py[i] - m.y
          const d2 = dx * dx + dy * dy
          if (8100 > d2) {
            const d = Math.sqrt(d2) || 1
            const f = (90 - d) * 0.06
            vx[i] += (dx / d) * f
            vy[i] += (dy / d) * f
          }
        }
        px[i] += vx[i]
        py[i] += vy[i]
      } else {
        px[i] = tx
        py[i] = ty
      }
      const depth = Math.min(1, Math.max(0, (z2 + 1) * 0.5))
      const accent = i >= lineN
      const al = accent ? 0.6 + depth * 0.4 : 0.14 + depth * 0.6
      const sz = (accent ? 2 : 1.2) + depth * 1.4
      ctx.fillStyle = 'rgba(' + (accent ? accRGB : baseRGB) + ',' + al.toFixed(2) + ')'
      ctx.fillRect(px[i] - sz / 2, py[i] - sz / 2, sz, sz)
    }

    // Words only link points that are close (16 px mobile / 20 px desktop). 3D shapes link up to
    // 44 / 60 px, less when the shape is drawn small (the Qgent panel header) so it doesn't turn
    // into a solid blob.
    const M = shape.text ? (small ? 240 : 320) : small ? 110 : 170
    const th = shape.text ? (small ? 16 : 20) : Math.min(small ? 44 : 60, sc * 0.45)
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(' + baseRGB + ',' + (shape.text ? '0.28' : '0.12') + ')'
    ctx.beginPath()
    for (let i = 0; M > i; i++) {
      for (let j = i + 1; M > j; j++) {
        const dx = px[i] - px[j]
        const dy = py[i] - py[j]
        if (th * th > dx * dx + dy * dy) {
          ctx.moveTo(px[i], py[i])
          ctx.lineTo(px[j], py[j])
        }
      }
    }
    ctx.stroke()
    if (m) {
      ctx.strokeStyle = 'rgba(' + accRGB + ',0.35)'
      ctx.beginPath()
      for (let i = 0; M > i; i++) {
        const dx = px[i] - m.x
        const dy = py[i] - m.y
        if (14400 > dx * dx + dy * dy) {
          ctx.moveTo(m.x, m.y)
          ctx.lineTo(px[i], py[i])
        }
      }
      ctx.stroke()
    }
    if (raised) ctx.restore()
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
    for (const s of state.values()) s.cleanup()
    state.clear()
    offs.forEach((off) => off())
    cv.style.zIndex = '0'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
  }
}
