'use client'

// The /qads background: "studio lights" over a dot grid. Same family as the AssetraDigital site
// (dot grid, mint + ice, light around the pointer — packages/ui/particles), a different motif for
// an ad studio. The composer box ([data-qz-subject]) is the product on set: two studio spots shine
// down from above the page and circle it like rim lights, so their glow spills out around its
// edges (with the box off screen they drift over the page). Dots under a light light up
// (overexposed at the centre) and bulge slightly as if seen through a lens; the pointer is a key
// light that follows with a little lag, a glint sweeps across now and then,
// and a click or Generate fires a camera flash (window event 'qz:flash' with { x, y }). Dots
// behind text ([data-qz-calm]) stay quiet so the copy reads. Colours come from the --q-* tokens,
// so it follows the theme. With animations off (data-motion="off") or reduced motion it is one
// still frame.

import { useEffect, useRef } from 'react'

type RGB = [number, number, number]

const GAP = 28
const GAP_SMALL = 24
const ALPHA_STEPS = 12
const TINTS = 3 // mint, ice, highlight
const FLASH_MS = 900

const rgbOf = (v: string, fallback: RGB): RGB => {
  const n = v.trim().split(/[\s,]+/).map(Number)
  return n.length >= 3 && n.every((x) => Number.isFinite(x)) ? [n[0], n[1], n[2]] : fallback
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB
const css = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`
/** Soft light falloff: 1 at the centre, 0 at the edge, smooth on both ends. */
const fall = (d: number, r: number) => {
  if (d >= r) return 0
  const t = 1 - d / r
  return t * t * (3 - 2 * t)
}

interface Light { x: number; y: number; r: number; k: number; tint: 0 | 1 }
interface Flash { x: number; y: number; t: number }

export function QadsBackdrop() {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    let W = 0
    let H = 0
    let dpr = 1
    let raf = 0
    let dark = true
    let still = false
    let ink: RGB = [238, 242, 240]
    let tints: [RGB, RGB, RGB] = [[95, 245, 196], [124, 200, 255], [210, 250, 236]]
    let styles: string[] = []
    const batches: number[][] = Array.from({ length: TINTS * (ALPHA_STEPS + 1) }, () => [])
    let calm: Element[] = []
    let subject: Element | null = null
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, on: false }
    const flashes: Flash[] = []
    const t0 = performance.now()

    const readTheme = () => {
      dark = root.dataset.theme !== 'light'
      still = root.dataset.motion === 'off' || reduce.matches
      const cs = getComputedStyle(root)
      ink = rgbOf(cs.getPropertyValue('--q-ink-rgb'), dark ? [238, 242, 240] : [11, 13, 12])
      const acc = rgbOf(cs.getPropertyValue('--q-acc-rgb'), [95, 245, 196])
      const acc2 = rgbOf(cs.getPropertyValue('--q-acc2-rgb'), [124, 200, 255])
      // On the light theme the bright mint is pulled toward the ink so lit dots still read; the
      // highlight is the overexposed centre of a light (near white on dark, deep green on light).
      tints = [dark ? acc : mix(acc, ink, 0.35), acc2, dark ? mix(acc, ink, 0.72) : mix(acc, ink, 0.62)]
      styles = []
      for (const c of tints) for (let q = 0; q <= ALPHA_STEPS; q++) styles.push(css(c, q / ALPHA_STEPS))
    }

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
    }

    const draw = (now: number) => {
      const T = still ? 12 : (now - t0) / 1000
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const small = W < 720
      const gap = small ? GAP_SMALL : GAP

      // Two rim lights circling the subject in opposite directions, breathing a little. Off screen
      // the subject gives way to a wide ellipse over the page.
      const big = Math.max(W, H)
      const box = subject?.getBoundingClientRect()
      const onSet = !!box && box.bottom > 0 && box.top < H
      const cx = box && onSet ? box.left + box.width / 2 : W / 2
      const cy = box && onSet ? box.top + box.height / 2 : H * 0.45
      const rx = box && onSet ? box.width / 2 + (small ? 30 : 110) : W * 0.36
      const ry = box && onSet ? box.height / 2 + (small ? 110 : 150) : H * 0.3
      const a1 = T * 0.16 + 0.8
      const a2 = -T * 0.11 + 3.6
      const lights: Light[] = [
        { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1), r: big * (small ? 0.6 : 0.3), k: 0.85 + 0.12 * Math.sin(T * 0.4), tint: 0 },
        { x: cx + rx * 1.08 * Math.cos(a2), y: cy + ry * 0.92 * Math.sin(a2), r: big * (small ? 0.52 : 0.26), k: 0.72 + 0.12 * Math.sin(T * 0.33 + 1), tint: 1 },
      ]
      // The key light follows the pointer with a little lag.
      if (pointer.on && !still) {
        pointer.x += (pointer.tx - pointer.x) * 0.09
        pointer.y += (pointer.ty - pointer.y) * 0.09
        lights.push({ x: pointer.x, y: pointer.y, r: 260, k: 1, tint: 0 })
      }

      // The studio spots shine down from above the page: a soft cone to each drifting light, then
      // haze where it lands — the room is lit, not only the dots.
      ctx.globalCompositeOperation = dark ? 'screen' : 'source-over'
      // (Not on phones: the narrow cones would band behind the headline.)
      for (let i = 0; i < (small ? 0 : 2); i++) {
        const l = lights[i]
        const sx = l.x + (i ? -0.22 : 0.18) * W
        const sy = -H * 0.3
        const ang = Math.atan2(l.y - sy, l.x - sx)
        const nx = -Math.sin(ang)
        const ny = Math.cos(ang)
        // The cone runs a little past the light and fades out there, so it has no hard end; four
        // nested layers of decreasing width give it soft edges (no canvas blur needed).
        const ex = sx + (l.x - sx) * 1.25
        const ey = sy + (l.y - sy) * 1.25
        const beam = ctx.createLinearGradient(sx, sy, ex, ey)
        beam.addColorStop(0, css(tints[l.tint], 0))
        beam.addColorStop(0.62, css(tints[l.tint], (dark ? 0.03 : 0.024) * l.k))
        beam.addColorStop(0.8, css(tints[l.tint], (dark ? 0.022 : 0.018) * l.k))
        beam.addColorStop(1, css(tints[l.tint], 0))
        ctx.fillStyle = beam
        for (const w of [1, 0.78, 0.56, 0.34]) {
          const spread = l.r * 0.62 * w
          ctx.beginPath()
          ctx.moveTo(sx + nx * 14 * w, sy + ny * 14 * w)
          ctx.lineTo(sx - nx * 14 * w, sy - ny * 14 * w)
          ctx.lineTo(ex - nx * spread, ey - ny * spread)
          ctx.lineTo(ex + nx * spread, ey + ny * spread)
          ctx.closePath()
          ctx.fill()
        }
      }
      for (const l of lights) {
        const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r)
        g.addColorStop(0, css(tints[l.tint], (dark ? 0.2 : 0.12) * l.k))
        g.addColorStop(0.45, css(tints[l.tint], (dark ? 0.075 : 0.05) * l.k))
        g.addColorStop(1, css(tints[l.tint], 0))
        ctx.fillStyle = g
        ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2)
      }
      ctx.globalCompositeOperation = 'source-over'

      // Where the copy sits the dots stay quiet.
      const quiet = calm.map((el) => el.getBoundingClientRect()).filter((r) => r.bottom > -20 && r.top < H + 20)

      // A glint sweeps diagonally across every few seconds, like light catching a lens.
      const cycle = 11
      const p = (T % cycle) / cycle
      const glint = still ? -1 : p * (W + H + 600) - 300
      // Camera flashes: a bright ring that opens and fades.
      for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].t > FLASH_MS) flashes.splice(i, 1)

      for (const b of batches) b.length = 0
      const add = (x: number, y: number, size: number, tint: number, alpha: number) => {
        const q = Math.min(ALPHA_STEPS, Math.max(1, Math.round(alpha * ALPHA_STEPS)))
        batches[tint * (ALPHA_STEPS + 1) + q].push(x, y, size)
      }

      ctx.fillStyle = css(ink, dark ? 0.075 : 0.1)
      const off = gap / 2
      for (let gy = off; gy < H; gy += gap) {
        for (let gx = off; gx < W; gx += gap) {
          let k = 0
          let tint = 0
          let sx = 0
          let sy = 0
          for (const l of lights) {
            const dx = gx - l.x
            const dy = gy - l.y
            const d = Math.sqrt(dx * dx + dy * dy) || 1
            const f = fall(d, l.r) * l.k
            if (f <= 0) continue
            if (f > k) { k = f; tint = l.tint }
            // The lens bulge: dots lean away from the light's centre, most on its shoulder.
            const push = f * (1 - f) * 7
            sx += (dx / d) * push
            sy += (dy / d) * push
          }
          if (glint > -300) {
            const dg = Math.abs((gx + gy) - glint) / 1.414
            if (dg < 54) k = Math.max(k, (1 - dg / 54) * 0.42)
          }
          for (const f of flashes) {
            const age = (now - f.t) / FLASH_MS
            const R = 40 + age * Math.max(W, H) * 0.55
            const dd = Math.abs(Math.hypot(gx - f.x, gy - f.y) - R)
            if (dd < 70) {
              const v = (1 - dd / 70) * (1 - age) * 1.1
              if (v > k) { k = v; tint = 1 }
            }
          }
          for (const r of quiet) {
            if (gx > r.left - 14 && gx < r.right + 14 && gy > r.top - 14 && gy < r.bottom + 14) { k *= 0.22; sx *= 0.3; sy *= 0.3; break }
          }
          if (k > 0.03) add(gx + sx, gy + sy, 1.4 + k * 3, k > 0.74 ? 2 : tint, 0.12 + k * 0.78)
          else ctx.fillRect(gx - 0.75, gy - 0.75, 1.5, 1.5)
        }
      }
      for (let i = 0; i < batches.length; i++) {
        const list = batches[i]
        if (!list.length) continue
        ctx.fillStyle = styles[i]
        for (let q = 0; q < list.length; q += 3) {
          const s = list[q + 2]
          ctx.fillRect(list[q] - s / 2, list[q + 1] - s / 2, s, s)
        }
      }
    }

    const loop = (now: number) => {
      draw(now)
      raf = still || document.hidden ? 0 : requestAnimationFrame(loop)
    }
    const restart = () => {
      cancelAnimationFrame(raf)
      raf = 0
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

    const collectCalm = () => {
      calm = [...document.querySelectorAll('[data-qz-calm]')]
      subject = document.querySelector('[data-qz-subject]')
    }
    collectCalm()
    const calmObs = new MutationObserver(collectCalm)
    calmObs.observe(document.body, { childList: true, subtree: true })
    readTheme()
    resize()
    restart()
    const themeObs = new MutationObserver(() => { readTheme(); restart() })
    themeObs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] })
    const onResize = () => { resize(); if (still) draw(performance.now()) }
    const onVis = () => restart()
    const onReduce = () => { readTheme(); restart() }
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('qz:flash', onFlash)
    document.addEventListener('visibilitychange', onVis)
    reduce.addEventListener('change', onReduce)
    return () => {
      cancelAnimationFrame(raf)
      themeObs.disconnect()
      calmObs.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('qz:flash', onFlash)
      document.removeEventListener('visibilitychange', onVis)
      reduce.removeEventListener('change', onReduce)
    }
  }, [])

  return <canvas ref={ref} className="qz-backdrop" aria-hidden="true" />
}
