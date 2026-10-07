'use client'

import { useEffect } from 'react'
import { particleStore, type ParticleMode as Mode } from './store'

/**
 * Switches the root <ParticleField> on for the subtree's lifetime. 'site' is the full
 * AssetraDigital background (grid, light band, ripples, paths between zones); 'app' is the
 * calm variant for the Quante app, where particles appear only inside zones.
 */
export function ParticleMode({ mode }: { mode: Exclude<Mode, 'off'> }) {
  useEffect(() => particleStore.pushMode(mode), [mode])
  return null
}
