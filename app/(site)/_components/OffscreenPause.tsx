'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Pauses every looping CSS animation in a page section (or card) while it is off screen
 * (data-still, site.css). Browsers keep running them out of view: measured on the AI homepage
 * (phone, CPU 4×), the hero's shine, the button beams, the marquees and the floating cards cost
 * ~0.6 s of main-thread work per second wherever the page was scrolled. A section starts again
 * half a screen before it scrolls in, so nothing is ever seen standing still.
 */
export function OffscreenPause() {
  const pathname = usePathname()

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) delete (e.target as HTMLElement).dataset.still
        else (e.target as HTMLElement).dataset.still = ''
      }
    }, { rootMargin: '50% 0px' })
    // Sections, plus the cards and stages inside them that loop on their own: on a phone a section
    // is several screens tall.
    const els = document.querySelectorAll<HTMLElement>(
      '.ad main > :not(.ad-q), .ad main > .ad-q > *, .ad > footer, .ad main :is(.card, .prod, .vis, .stage, .pr-stage, .br-stage)',
    )
    els.forEach((el) => io.observe(el))
    return () => {
      io.disconnect()
      els.forEach((el) => delete el.dataset.still)
    }
  }, [pathname])

  return null
}
