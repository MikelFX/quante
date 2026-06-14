'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { MOTION_CONFIG, type MotionConfig, type MotionLevel } from './config'

const MotionLevelContext = createContext<MotionLevel>('subtle')

export function MotionProvider({ level, children }: { level: MotionLevel; children: ReactNode }) {
  return (
    <MotionLevelContext.Provider value={level}>
      {children}
    </MotionLevelContext.Provider>
  )
}

export function useMotionLevel(): MotionLevel {
  return useContext(MotionLevelContext)
}

export function useMotionConfig(): MotionConfig {
  return MOTION_CONFIG[useMotionLevel()]
}
