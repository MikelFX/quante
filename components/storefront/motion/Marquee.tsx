'use client'

// Infinite horizontal ticker. Duplicates children once so the loop is seamless.
// Pause on hover via CSS animation-play-state — zero JS jank.

import { useId } from 'react'
import type { ReactNode } from 'react'
import { useEffectiveMotion } from './hooks'
import { useMotionConfig } from './context'

interface Props {
  children: ReactNode
  duration?: number
  gap?: string
  reverse?: boolean
  pauseOnHover?: boolean
}

export function Marquee({ children, duration = 28, gap = '3rem', reverse = false, pauseOnHover = true }: Props) {
  const uid = useId().replace(/[^a-z0-9]/gi, 'x')
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const enabled = cfg.enabled && effectiveLevel !== 'none'

  if (!enabled) {
    return (
      <div style={{ display: 'flex', gap, flexWrap: 'wrap' }}>
        {children}
      </div>
    )
  }

  const kf = `mq${uid}`

  return (
    <>
      <style>{`
        @keyframes ${kf} {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .${kf} {
          animation: ${kf} ${duration}s linear infinite${reverse ? ' reverse' : ''};
          will-change: transform;
        }
        ${pauseOnHover ? `.${kf}:hover { animation-play-state: paused; }` : ''}
      `}</style>
      <div style={{ overflow: 'hidden' }}>
        <div className={kf} style={{ display: 'flex', gap, width: 'max-content' }}>
          <div style={{ display: 'flex', gap }}>{children}</div>
          <div style={{ display: 'flex', gap }} aria-hidden="true">{children}</div>
        </div>
      </div>
    </>
  )
}
