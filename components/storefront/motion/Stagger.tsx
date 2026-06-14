'use client'

// Stagger + StaggerItem: orchestrate entrance of a list of items.
// Usage: <Stagger style={gridStyle}><StaggerItem style={cellStyle}>...</StaggerItem></Stagger>
// StaggerItem inherits variants from Stagger via Framer Motion's variant propagation.

import { motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'
import { useMotionConfig } from './context'
import { useEffectiveMotion } from './hooks'

interface Props {
  children: ReactNode
  className?: string
  style?: CSSProperties
  delay?: number
}

export function Stagger({ children, className, style, delay = 0 }: Props) {
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()

  if (!cfg.enabled || effectiveLevel === 'none') {
    return <div className={className} style={style}>{children}</div>
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: cfg.stagger, delayChildren: delay } },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className, style }: Omit<Props, 'delay'>) {
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()

  if (!cfg.enabled || effectiveLevel === 'none') {
    return <div className={className} style={style}>{children}</div>
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: cfg.revealY },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: cfg.duration.base, ease: cfg.ease },
        },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}
