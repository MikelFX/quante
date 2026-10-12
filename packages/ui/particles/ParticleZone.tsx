'use client'

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react'
import { particleStore } from './store'

export interface ParticleZoneProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape keys: '@logo' | '@sphere' | '@torus' | '@cube' | '@wave', or any text ('WEB', '0 Kč', '§'). */
  shapes: string[]
  /** On a floating panel (the Qgent assistant), not in the page: left out of the path between zones. */
  floating?: boolean
}

// The engine sizes the canvas (larger than the zone: 3D shapes reach past it) and draws into it;
// until then it holds no pixels (a canvas is 300 × 150 by default).
const CANVAS: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 0, height: 0, pointerEvents: 'none' }

/**
 * A particle formation in the content: its own dots, which take its shapes in turn and stay on
 * this spot — they never fly to another zone and don't react to the mouse or touch. Draws the mint
 * corner brackets and holds the canvas <ParticleField>'s engine paints the dots into.
 */
export function ParticleZone({ shapes, floating = false, className, children, ...rest }: ParticleZoneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const key = shapes.join('|')

  useEffect(() => {
    const el = ref.current
    const canvas = cv.current
    if (!el || !canvas) return
    return particleStore.addZone(el, canvas, key.split('|'), floating)
  }, [key, floating])

  return (
    <div ref={ref} className={className ? 'pz ' + className : 'pz'} data-shapes={key} aria-hidden="true" {...rest}>
      <canvas ref={cv} width={0} height={0} style={CANVAS} />
      {children}
    </div>
  )
}
