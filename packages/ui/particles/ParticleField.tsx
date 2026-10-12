'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { particleStore } from './store'

const getMode = () => particleStore.getMode()
const getServerMode = () => 'off' as const

/**
 * The website's fixed background canvas (dot grid, ripples, light band, path between zones) and
 * the engine, which also draws every <ParticleZone>'s formation into that zone's own canvas.
 * Lives in the root layout so it survives client navigation. Renders nothing until a
 * <ParticleMode> below it switches it on, and loads the engine only after the page has
 * finished loading and the browser is idle, so it never competes with the first paint.
 */
export function ParticleField() {
  const mode = useSyncExternalStore(particleStore.subscribeMode, getMode, getServerMode)
  const enabled = mode !== 'off'
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!enabled) return
    let stop: (() => void) | undefined
    let cancelled = false
    let idle = 0
    let timer = 0

    const start = () => {
      import('./engine').then(({ startParticles }) => {
        if (!cancelled && ref.current) stop = startParticles(ref.current)
      })
    }
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(start, { timeout: 1500 })
      else timer = window.setTimeout(start, 200)
    }
    if (document.readyState === 'complete') whenIdle()
    else window.addEventListener('load', whenIdle, { once: true })

    return () => {
      cancelled = true
      window.removeEventListener('load', whenIdle)
      if (idle) window.cancelIdleCallback(idle)
      if (timer) window.clearTimeout(timer)
      stop?.()
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: 'fixed', left: 0, top: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
    />
  )
}
