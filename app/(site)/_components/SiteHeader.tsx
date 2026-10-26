'use client'

import { usePathname } from 'next/navigation'
import { FloatingNav, MotionToggle } from '@ad/ui'
import { cta, nav } from '@/content/assetra/site'

/** Site navigation: in-page anchors on the homepage, /#section links everywhere else. The
 *  consultation button stays on the page when it has its own contact form (home, Web & Eshop). */
export function SiteHeader() {
  const path = usePathname()
  const home = path === '/'
  const to = (id: string) => (home ? '#' : '/#') + id
  return (
    <FloatingNav
      homeHref={home ? '#top' : '/'}
      links={nav.map((l) => ({ href: l.href ?? to(l.id ?? ''), label: l.label, num: l.num }))}
      cta={{ href: home || path === '/web-eshop' ? '#' + cta.target : to(cta.target), label: cta.label }}
      actions={<MotionToggle />}
    />
  )
}
