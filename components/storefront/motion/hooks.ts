'use client'

import { useEffect, useState } from 'react'
import { useMotionLevel } from './context'
import type { MotionLevel } from './config'

// SSR-safe: starts false on server, updates after hydration via media query.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

// Use this everywhere instead of useMotionLevel() directly.
// Returns 'none' when the OS signals prefers-reduced-motion.
export function useEffectiveMotion(): MotionLevel {
  const level = useMotionLevel()
  const reduced = usePrefersReducedMotion()
  return reduced ? 'none' : level
}
