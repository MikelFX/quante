'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Sections below the first screen use content-visibility:auto (site.css), so until they have been
 * rendered once the browser only knows an estimated height. A smooth scroll to #cenik from the top
 * would then stop short while the sections in between grow. Once the page has loaded and the browser
 * is idle (after LCP), this renders every section for one frame so their real sizes are remembered
 * (contain-intrinsic-size: auto), then hands them back to lazy rendering.
 */
export function SectionSizes() {
  const pathname = usePathname()

  useEffect(() => {
    const root = document.documentElement
    let raf = 0
    let idle = 0
    let timer = 0
    const measure = () => {
      root.classList.add('ad-cv-measure')
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => root.classList.remove('ad-cv-measure'))
      })
    }
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(measure, { timeout: 2000 })
      else timer = window.setTimeout(measure, 300)
    }
    if (document.readyState === 'complete') whenIdle()
    else window.addEventListener('load', whenIdle, { once: true })
    return () => {
      window.removeEventListener('load', whenIdle)
      if (idle) window.cancelIdleCallback(idle)
      if (timer) window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      root.classList.remove('ad-cv-measure')
    }
  }, [pathname])

  return null
}
