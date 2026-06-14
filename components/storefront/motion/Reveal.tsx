'use client'

// Scroll-triggered reveal. Only transform + opacity — zero CLS guaranteed.
// The initial opacity:0 occupies its natural layout space before animating in.

import { motion } from 'framer-motion'
import type { TargetAndTransition } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'
import { useMotionConfig } from './context'
import { useEffectiveMotion } from './hooks'

export type RevealVariant = 'fade' | 'fade-up' | 'blur-in'

interface RevealProps {
  children: ReactNode
  variant?: RevealVariant
  delay?: number
  className?: string
  style?: CSSProperties
}

export function Reveal({ children, variant = 'fade-up', delay = 0, className, style }: RevealProps) {
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()

  if (!cfg.enabled || effectiveLevel === 'none') {
    return <div className={className} style={style}>{children}</div>
  }

  // blur-in is expressive-only (filter: blur() triggers layer repaint)
  const useBlur = variant === 'blur-in' && effectiveLevel === 'expressive' && cfg.revealBlur > 0

  const hidden: TargetAndTransition = {
    opacity: 0,
    y: variant === 'fade-up' ? cfg.revealY : 0,
    ...(useBlur ? { filter: `blur(${cfg.revealBlur}px)` } : {}),
  }

  const visible: TargetAndTransition = {
    opacity: 1,
    y: 0,
    ...(useBlur ? { filter: 'blur(0px)' } : {}),
    transition: { duration: cfg.duration.base, delay, ease: cfg.ease },
  }

  return (
    <motion.div
      initial={hidden}
      whileInView={visible}
      viewport={{ once: true }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}
