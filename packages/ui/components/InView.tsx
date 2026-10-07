'use client'

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'

type Tag = 'section' | 'div' | 'footer' | 'header' | 'article'

/**
 * Sets data-in="true" once the element scrolls into view (IntersectionObserver, threshold 0.04,
 * fires once). Every .rv / .ttl / slot-number / bar animation inside waits for it.
 */
export function InView({ as = 'section', initial = false, threshold = 0.04, children, ...rest }: { as?: Tag; initial?: boolean; threshold?: number; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(initial)

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver !== 'function') {
      const t = window.setTimeout(() => setInView(true))
      return () => window.clearTimeout(t)
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true)
        io.disconnect()
      }
    }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [inView, threshold])

  // All allowed tags render an HTMLElement; typed as <section> so one ref type fits them all.
  const Tag = as as 'section'
  return <Tag ref={ref} data-in={inView ? 'true' : 'false'} {...rest}>{children}</Tag>
}
