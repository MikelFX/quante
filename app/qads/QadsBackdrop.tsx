'use client'

// The /qads background: a photo studio built from dots. Same family as the AssetraDigital site
// (dot grid, mint + ice — packages/ui/particles), its own scene: a dotted floor in perspective runs
// to a horizon behind the composer box ([data-qz-subject], the product on set) and a dotted back
// wall rises behind the headline. Two studio spots shine down through the air (soft cones on a
// blurred layer), circle the product and leave elliptical pools of light on the floor and a wash
// on the wall; dust drifts in their beams; the camera dollies slowly forward. The pointer is a
// hand-held light (a pool on the floor below the horizon, a wash on the wall above it); a click or
// Generate fires a camera flash (window event 'qz:flash' with { x, y }). Dots behind the copy
// ([data-qz-calm]) stay quiet. Colours come from the --q-* tokens (dark + light). With animations
// off (data-motion="off") or reduced motion it is one still frame.

import { useEffect, useRef } from 'react'

type RGB = [number, number, number]

const ALPHA_STEPS = 10
const TINTS = 4 // ink, mint, ice, highlight
const AIR_SCALE = 0.25 // the blurred air layer renders at a quarter of the resolution
const FLASH_MS = 950
const MOTES = 70

/** Floor geometry in world units: camera 1 unit above the floor, dots SPACING apart. */
const SPACING = 0.2
const Z_FAR = 6.6 // the back wall stands here
const PRODUCT_Z = 3

const rgbOf = (v: string, fallback: RGB): RGB => {
  const n = v.trim().split(/[\s,]+/).map(Number)
  return n.length >= 3 && n.every((x) => Number.isFinite(x)) ? [n[0], n[1], n[2]] : fallback
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB
const css = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Soft falloff: 1 at the centre, 0 at r, smooth at both ends. */
const fall = (d: number, r: number) => {
  if (d >= r) return 0
  const t = 1 - d / r
  return t * t * (3 - 2 * t)
}

interface Pool { X: number; Z: number; R: number; k: number; tint: 1 | 2 }
interface Wash { x: number; y: number; r: number; k: number; tint: 1 | 2 }
interface Beam { sx: number; sy: number; px: number; py: number; w: number; k: number; tint: 1 | 2 }
interface Mote { x: number; y: number; vx: number; vy: number; s: number; tw: number }

export function QadsBackdrop() {
  const airRef = useRef<HTMLCanvasElement | null>(null)
  const dotsRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const air = airRef.current
    const dots = dotsRef.current
    const actx = air?.getContext('2d')
    const ctx = dots?.getContext('2d')
    if (!air || !dots || !actx || !ctx) return
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    let W = 0
    let H = 0
    let dpr = 1
    let raf = 0
    let dark = true
    let still = false
    let tints: RGB[] = [[238, 242, 240], [95, 245, 196], [124, 200, 255], [214, 252, 240]]
    let styles: string[] = []
    let halos: HTMLCanvasElement[] = []
    let calm: Element[] = []
    let subject: Element | null = null
    const batches: number[][] = Array.from({ length: TINTS * (ALPHA_STEPS + 1) }, () => [])
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: false }
    const flashes: { x: number; y: number; t: number }[] = []
    const motes: Mote[] = []
    const t0 = performance.now()
    let lastNow = t0

    // A soft round glow, drawn once per tint and stamped behind bright dots.
    const makeHalo = (c: RGB) => {
      const s = 48
      const h = document.createElement('canvas')
      h.width = h.height = s
      const g = h.getContext('2d')!
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      grad.addColorStop(0, css(c, 0.9))
      grad.addColorStop(0.25, css(c, 0.35))
      grad.addColorStop(1, css(c, 0))
      g.fillStyle = grad
      g.fillRect(0, 0, s, s)
      return h
    }

    const readTheme = () => {
      dark = root.dataset.theme !== 'light'
      still = root.dataset.motion === 'off' || reduce.matches
      const cs = getComputedStyle(root)
      const ink = rgbOf(cs.getPropertyValue('--q-ink-rgb'), dark ? [238, 242, 240] : [11, 13, 12])
      const acc = rgbOf(cs.getPropertyValue('--q-acc-rgb'), [95, 245, 196])
      const acc2 = rgbOf(cs.getPropertyValue('--q-acc2-rgb'), [124, 200, 255])
      // On the light theme the bright mint is pulled toward the ink so lit dots still read.
      tints = [ink, dark ? acc : mix(acc, ink, 0.4), dark ? acc2 : mix(acc2, ink, 0.25), dark ? mix(acc, ink, 0.75) : mix(acc, ink, 0.65)]
      styles = []
      for (const c of tints) for (let q = 0; q <= ALPHA_STEPS; q++) styles.push(css(c, q / ALPHA_STEPS))
      halos = tints.map(makeHalo)
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      dots.width = Math.round(W * dpr)
      dots.height = Math.round(H * dpr)
      air.width = Math.max(1, Math.round(W * AIR_SCALE))
      air.height = Math.max(1, Math.round(H * AIR_SCALE))
      motes.length = 0
      for (let i = 0; i < MOTES; i++) {
        motes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.012, vy: -0.004 - Math.random() * 0.01, s: 0.5 + Math.random() * 1.1, tw: Math.random() * 6.28 })
      }
    }

    const draw = (now: number) => {
      const T = still ? 14 : (now - t0) / 1000
      const dt = Math.min(64, now - lastNow)
      lastNow = now
      const small = W < 720

      // ── The set: horizon behind the product, focal length from the viewport. ──
      const box = subject?.getBoundingClientRect()
      const onSet = !!box && box.bottom > 0 && box.top < H
      const cx = W / 2
      // The horizon runs along the top of the product, so the floor shows on both sides of it.
      const yh = box && onSet ? Math.min(H * 0.72, Math.max(H * 0.28, box.top + 6)) : H * 0.5
      const f = Math.max(H, W * 0.62) * 0.95
      const sx = (X: number, Z: number) => cx + (f * X) / Z
      const sy = (Z: number) => yh + f / Z
      const z0 = f / (H + 30 - yh) // nearest visible floor row
      const yj = yh + f / Z_FAR // where the floor meets the back wall

      // ── Lights: two spots circling the product, plus the pointer's hand-held light. ──
      const a1 = T * 0.14 + 0.9
      const a2 = -T * 0.1 + 3.8
      const pools: Pool[] = [
        { X: Math.cos(a1) * 2.1, Z: PRODUCT_Z + Math.sin(a1) * 0.9, R: 1.25, k: 0.9 + 0.08 * Math.sin(T * 0.5), tint: 1 },
        { X: Math.cos(a2) * 2.4, Z: PRODUCT_Z + 0.4 + Math.sin(a2) * 1.1, R: 1.1, k: 0.78 + 0.08 * Math.sin(T * 0.37 + 1), tint: 2 },
      ]
      const washes: Wash[] = pools.map((p) => ({ x: sx(p.X * 1.3, Z_FAR), y: yj - (f * 1.2) / Z_FAR, r: (f * 1.7) / Z_FAR, k: p.k * 0.8, tint: p.tint }))
      if (pointer.on && !still) {
        pointer.x += (pointer.tx - pointer.x) * 0.08
        pointer.y += (pointer.ty - pointer.y) * 0.08
        if (pointer.y > yj + 4) {
          const Z = f / (pointer.y - yh)
          pools.push({ X: ((pointer.x - cx) * Z) / f, Z, R: 0.75 + Z * 0.08, k: 1, tint: 1 })
        } else {
          washes.push({ x: pointer.x, y: pointer.y, r: 210, k: 0.95, tint: 1 })
        }
      }
      const beams: Beam[] = pools.slice(0, 2).map((p, i) => ({
        sx: sx(p.X, p.Z) + (i ? -0.2 : 0.16) * W,
        sy: -H * 0.18,
        px: sx(p.X, p.Z),
        py: sy(p.Z),
        w: (f * p.R) / p.Z,
        k: p.k,
        tint: p.tint,
      }))
      for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].t > FLASH_MS) flashes.splice(i, 1)

      // ── Air (blurred by CSS): aurora, beams, pools, the wall wash, the horizon seam, flash bloom. ──
      const q = AIR_SCALE
      actx.setTransform(q, 0, 0, q, 0, 0)
      actx.clearRect(0, 0, W, H)
      actx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      const A = dark ? 1 : 0.55
      const blob = (x: number, y: number, rx: number, ry: number, c: RGB, a: number) => {
        actx.save()
        actx.translate(x, y)
        actx.scale(1, ry / rx)
        const g = actx.createRadialGradient(0, 0, 0, 0, 0, rx)
        g.addColorStop(0, css(c, a))
        g.addColorStop(1, css(c, 0))
        actx.fillStyle = g
        actx.fillRect(-rx, -rx, rx * 2, rx * 2)
        actx.restore()
      }
      blob(W * (0.3 + 0.08 * Math.sin(T * 0.05)), H * 0.06, W * 0.36, H * 0.26, tints[2], 0.075 * A)
      blob(W * (0.72 + 0.07 * Math.sin(T * 0.04 + 2)), H * 0.0, W * 0.32, H * 0.22, tints[1], 0.06 * A)
      // Each cone is five nested layers: brightest along its axis, fading to nothing at its edges,
      // and fading in from the lamp — a beam of light, not a lit wall.
      for (const b of beams) {
        const ang = Math.atan2(b.py - b.sy, b.px - b.sx)
        const nx = -Math.sin(ang)
        const ny = Math.cos(ang)
        const g = actx.createLinearGradient(b.sx, b.sy, b.px, b.py)
        g.addColorStop(0, css(tints[b.tint], 0))
        g.addColorStop(0.5, css(tints[b.tint], 0.026 * b.k * A))
        g.addColorStop(1, css(tints[b.tint], 0.05 * b.k * A))
        actx.fillStyle = g
        for (const s of [1, 0.78, 0.58, 0.4, 0.24]) {
          const top = 4 + 10 * s
          const half = b.w * 0.62 * s
          actx.beginPath()
          actx.moveTo(b.sx + nx * top, b.sy + ny * top)
          actx.lineTo(b.sx - nx * top, b.sy - ny * top)
          actx.lineTo(b.px - nx * half, b.py - ny * half)
          actx.lineTo(b.px + nx * half, b.py + ny * half)
          actx.closePath()
          actx.fill()
        }
      }
      for (const p of pools) {
        const w = (f * p.R) / p.Z
        blob(sx(p.X, p.Z), sy(p.Z), w * 0.85, w * 0.85 * (f / p.Z / (f / p.Z + 160)) * 0.6, tints[p.tint], 0.26 * p.k * A)
      }
      for (const w of washes) blob(w.x, w.y, w.r * 1.1, w.r * 0.8, tints[w.tint], 0.16 * w.k * A)
      blob(cx, yj, W * 0.5, 30, tints[1], 0.14 * A) // the seam where the floor meets the wall
      for (const fl of flashes) {
        const age = (now - fl.t) / FLASH_MS
        blob(fl.x, fl.y, 260 + age * 380, 260 + age * 380, tints[3], 0.55 * (1 - age) * (1 - age))
      }
      actx.globalCompositeOperation = 'source-over'

      // ── Dots: the back wall, then the floor rows (far to near). ──
      for (const b of batches) b.length = 0
      const quiet = calm.map((el) => el.getBoundingClientRect()).filter((r) => r.bottom > -20 && r.top < H + 20)
      const isQuiet = (x: number, y: number) => {
        for (const r of quiet) if (x > r.left - 12 && x < r.right + 12 && y > r.top - 12 && y < r.bottom + 12) return true
        return false
      }
      const glow: number[] = [] // x, y, size, tint, strength — halos for the brightest dots
      const put = (x: number, y: number, r: number, base: number, k: number, tint: number) => {
        for (const fl of flashes) {
          const age = (now - fl.t) / FLASH_MS
          const R = 30 + age * Math.max(W, H) * 0.6
          const dd = Math.abs(Math.hypot(x - fl.x, y - fl.y) - R)
          if (dd < 80) { const v = (1 - dd / 80) * (1 - age); if (v > k) { k = v; tint = 3 } }
        }
        if (isQuiet(x, y)) { k *= 0.2; base *= 0.6 }
        const t = k > 0.78 ? 3 : k > 0.04 ? tint : 0
        const alpha = base + k * 0.85
        const rad = r * (1 + k * 1.15)
        const qa = Math.min(ALPHA_STEPS, Math.max(1, Math.round(clamp01(alpha) * ALPHA_STEPS)))
        batches[t * (ALPHA_STEPS + 1) + qa].push(x, y, rad)
        if (dark && k > 0.42) glow.push(x, y, rad * 7, t, (k - 0.42) * 1.2)
      }

      // The back wall: a flat grid standing on the far end of the floor, fading toward the top.
      const wallGap = (f * SPACING) / Z_FAR
      const yTop = -wallGap
      const wcols = Math.ceil(W / 2 / wallGap) + 1
      for (let wy = yj - wallGap * 0.5; wy > yTop; wy -= wallGap) {
        const up = (yj - wy) / Math.max(1, yj)
        const base = (dark ? 0.1 : 0.12) * (1 - up * 0.55)
        for (let c = -wcols; c <= wcols; c++) {
          const x = cx + c * wallGap
          let k = 0
          let tint = 1
          for (const w of washes) {
            const v = fall(Math.hypot(x - w.x, (wy - w.y) * 1.25), w.r) * w.k
            if (v > k) { k = v; tint = w.tint }
          }
          put(x, wy, small ? 0.75 : 0.85, base, k * 0.8, tint)
        }
      }

      // The floor: square grid in world space, sliding toward the camera (a slow dolly).
      const dolly = still ? 0 : (T * 0.09) % SPACING
      const zStart = Math.ceil((z0 - dolly) / SPACING) * SPACING + dolly
      for (let Z = Z_FAR; Z >= zStart; Z -= SPACING) {
        if (Z < z0 * 0.98) break
        const y = sy(Z)
        if (y > H + 8) continue
        const depth = clamp01((Z - z0) / (Z_FAR - z0))
        const base = 0.3 * Math.pow(1 - depth, 0.7) + (dark ? 0.04 : 0.045)
        const r = Math.max(0.55, 1.9 * Math.pow(z0 / Z, 0.85))
        const xHalf = ((W / 2 + 30) * Z) / f
        const c0 = Math.ceil(-xHalf / SPACING)
        const c1 = Math.floor(xHalf / SPACING)
        for (let c = c0; c <= c1; c++) {
          const X = c * SPACING
          let k = 0
          let tint = 1
          for (const p of pools) {
            const v = fall(Math.hypot(X - p.X, (Z - p.Z) * 1.1), p.R) * p.k
            if (v > k) { k = v; tint = p.tint }
          }
          put(sx(X, Z), y, r, base, k, tint)
        }
      }

      // ── Paint: haloes (additive), then the dots, then dust in the beams. ──
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (glow.length) {
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < glow.length; i += 5) {
          const s = glow[i + 2]
          ctx.globalAlpha = Math.min(0.5, glow[i + 4] * 0.5)
          ctx.drawImage(halos[glow[i + 3]], glow[i] - s / 2, glow[i + 1] - s / 2, s, s)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
      for (let i = 0; i < batches.length; i++) {
        const list = batches[i]
        if (!list.length) continue
        ctx.fillStyle = styles[i]
        ctx.beginPath()
        for (let j = 0; j < list.length; j += 3) {
          const r = list[j + 2]
          ctx.moveTo(list[j] + r, list[j + 1])
          ctx.arc(list[j], list[j + 1], r, 0, 6.2832)
        }
        ctx.fill()
      }
      if (dark) {
        ctx.globalCompositeOperation = 'lighter'
        for (const m of motes) {
          if (!still) {
            m.x += m.vx * dt
            m.y += m.vy * dt
            if (m.y < -10) { m.y = H + 10; m.x = Math.random() * W }
            if (m.x < -10) m.x = W + 10
            else if (m.x > W + 10) m.x = -10
          }
          // Dust is only seen where a beam lights it.
          let v = 0
          let tint = 1
          for (const b of beams) {
            const dx = b.px - b.sx
            const dy = b.py - b.sy
            const len2 = dx * dx + dy * dy
            const t = ((m.x - b.sx) * dx + (m.y - b.sy) * dy) / len2
            if (t < 0.15 || t > 1.05) continue
            const px = b.sx + dx * t
            const py = b.sy + dy * t
            const half = 8 + (b.w * 0.9 - 8) * Math.min(1, t)
            const d = Math.hypot(m.x - px, m.y - py)
            const w = fall(d, half) * b.k * Math.min(1, (t - 0.15) * 3)
            if (w > v) { v = w; tint = b.tint }
          }
          if (v < 0.03) continue
          const tw = 0.65 + 0.35 * Math.sin(T * 1.7 + m.tw)
          ctx.fillStyle = css(tints[tint === 2 ? 2 : 3], v * 0.9 * tw)
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.s, 0, 6.2832)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    const loop = (now: number) => {
      draw(now)
      raf = still || document.hidden ? 0 : requestAnimationFrame(loop)
    }
    const restart = () => {
      cancelAnimationFrame(raf)
      raf = 0
      lastNow = performance.now()
      if (still || document.hidden) draw(performance.now())
      else raf = requestAnimationFrame(loop)
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      pointer.tx = e.clientX
      pointer.ty = e.clientY
      if (!pointer.on) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true }
    }
    const onLeave = () => { pointer.on = false }
    const flash = (x: number, y: number) => {
      if (still) return
      flashes.push({ x, y, t: performance.now() })
      if (flashes.length > 4) flashes.shift()
    }
    const onDown = (e: PointerEvent) => flash(e.clientX, e.clientY)
    const onFlash = (e: Event) => {
      const d = (e as CustomEvent<{ x?: number; y?: number }>).detail ?? {}
      flash(d.x ?? W / 2, d.y ?? H / 2)
    }
    const collect = () => {
      calm = [...document.querySelectorAll('[data-qz-calm]')]
      subject = document.querySelector('[data-qz-subject]')
    }

    collect()
    readTheme()
    resize()
    restart()
    const domObs = new MutationObserver(collect)
    domObs.observe(document.body, { childList: true, subtree: true })
    const themeObs = new MutationObserver(() => { readTheme(); restart() })
    themeObs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] })
    const onResize = () => { resize(); if (still) draw(performance.now()) }
    const onScroll = () => { if (still) draw(performance.now()) }
    const onVis = () => restart()
    const onReduce = () => { readTheme(); restart() }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('qz:flash', onFlash)
    document.addEventListener('visibilitychange', onVis)
    reduce.addEventListener('change', onReduce)
    return () => {
      cancelAnimationFrame(raf)
      domObs.disconnect()
      themeObs.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('qz:flash', onFlash)
      document.removeEventListener('visibilitychange', onVis)
      reduce.removeEventListener('change', onReduce)
    }
  }, [])

  return (
    <div className="qz-backdrop" aria-hidden="true">
      <canvas ref={airRef} className="qz-air" />
      <canvas ref={dotsRef} className="qz-dots" />
    </div>
  )
}
