'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

type Shine = Animation & { animationName?: string }

/** Largest step the gradient may jump per update, CSS px: below this the motion looks continuous. */
const STEP_PX = 0.75

/**
 * The hero headline's highlighted letters carry a drifting gradient (ad-shine). background-clip:text
 * can only be painted on the main thread, so at 60 fps it was the most expensive thing at the top of
 * the page on phones (~35 % of the main thread, CPU 4×). This advances the same CSS animations at the
 * rate where every step stays under STEP_PX: about 20 fps for the small letters on a phone, full rate
 * for the wide desktop ones. Same motion, a third of the repaints. Off screen (data-still) it waits.
 */
export function ShineThrottle() {
  const pathname = usePathname()

  useEffect(() => {
    let anims: Shine[] = []
    let timer = 0
    let last = performance.now()
    let scanned = 0

    const collect = () => {
      scanned = performance.now()
      last = scanned
      anims = []
      let width = 0
      let dur = 4000
      document.querySelectorAll<HTMLElement>('.ad .h1 .hl').forEach((el) => {
        for (const a of el.getAnimations() as Shine[]) {
          if (a.animationName !== 'ad-shine') continue
          a.pause()
          anims.push(a)
          width = Math.max(width, el.getBoundingClientRect().width)
          dur = Number(a.effect?.getTiming().duration) || dur
        }
      })
      // background-size 200 %, position 0 → -200 %: the gradient travels twice the letter's width.
      const speed = (2 * width) / (dur / 1000)
      const fps = Math.min(60, Math.max(12, Math.ceil(speed / STEP_PX)))
      window.clearInterval(timer)
      if (anims.length) timer = window.setInterval(tick, 1000 / fps)
    }

    function tick() {
      const now = performance.now()
      const dt = now - last
      last = now
      // Animations off / on again: the CSS animations were replaced.
      if (anims.some((a) => a.playState === 'idle')) return collect()
      const el = anims[0]?.effect instanceof KeyframeEffect ? anims[0].effect.target : null
      if (!el || document.hidden || el.closest('[data-still]')) return
      for (const a of anims) a.currentTime = (Number(a.currentTime) || 0) + dt
    }

    collect()
    // Started with animations off: look again now and then, cheaply.
    const rescan = window.setInterval(() => { if (!anims.length && performance.now() - scanned > 900) collect() }, 1000)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(rescan)
      for (const a of anims) if (a.playState === 'paused') a.play()
    }
  }, [pathname])

  return null
}
