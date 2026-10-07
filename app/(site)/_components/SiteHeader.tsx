'use client'

import { usePathname } from 'next/navigation'
import { FloatingNav, MotionToggle } from '@ad/ui'
import { cta, nav } from '@/content/assetra/site'

/** Site navigation: in-page anchors on the homepage, /#section links everywhere else. */
export function SiteHeader() {
  const home = usePathname() === '/'
  const to = (id: string) => (home ? '#' : '/#') + id
  return (
    <FloatingNav
      homeHref={home ? '#top' : '/'}
      links={nav.map((l) => ({ href: l.href ?? to(l.id ?? ''), label: l.label, num: l.num }))}
      cta={{ href: to(cta.target), label: cta.label }}
      actions={<MotionToggle />}
    />
  )
}
