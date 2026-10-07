'use client'

import { useEffect, useRef, type HTMLAttributes } from 'react'
import { particleStore } from './store'

export interface ParticleZoneProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape keys: '@logo' | '@sphere' | '@torus' | '@cube' | '@wave', or any text ('WEB', '0 Kč', '§'). */
  shapes: string[]
  /** Wins over the zone nearest the viewport centre while visible (the open Qgent panel). */
  priority?: boolean
}

/**
 * A place in the content where the swarm lands and forms its shapes. Draws the mint corner
 * brackets; the particles themselves are painted by <ParticleField>.
 */
export function ParticleZone({ shapes, priority = false, className, children, ...rest }: ParticleZoneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const key = shapes.join('|')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return particleStore.addZone(el, key.split('|'), priority)
  }, [key, priority])

  return (
    <div ref={ref} className={className ? 'pz ' + className : 'pz'} data-shapes={key} aria-hidden="true" {...rest}>
      {children}
    </div>
  )
}
