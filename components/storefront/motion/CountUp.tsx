'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useMotionValue, useSpring } from 'framer-motion'
import { useEffectiveMotion } from './hooks'
import { useMotionConfig } from './context'

interface Props {
  to: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  style?: React.CSSProperties
  className?: string
}

export function CountUp({ to, decimals = 0, prefix = '', suffix = '', duration = 1.8, style, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-8% 0px' })
  const effectiveLevel = useEffectiveMotion()
  const cfg = useMotionConfig()
  const enabled = cfg.enabled && effectiveLevel !== 'none'

  const mv = useMotionValue(0)
  const spring = useSpring(mv, { duration: duration * 1000, bounce: 0 })
  const [display, setDisplay] = useState(enabled ? '0' : to.toFixed(decimals))

  useEffect(() => spring.on('change', (v) => setDisplay(v.toFixed(decimals))), [spring, decimals])

  useEffect(() => {
    if (!enabled) { setDisplay(to.toFixed(decimals)); return }
    if (isInView) mv.set(to)
  }, [isInView, enabled, mv, to, decimals])

  return (
    <span ref={ref} style={style} className={className}>
      {prefix}{display}{suffix}
    </span>
  )
}
