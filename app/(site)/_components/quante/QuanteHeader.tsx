'use client'

import { usePathname } from 'next/navigation'
import { AdMark, FloatingNav, MotionToggle, SmartLink } from '@ad/ui'
import { quanteApp, quanteHome } from '@/content/assetra/modules'
import { ProductsMenu, ProductsMenuList } from '../ProductsMenu'

/** The Quante pages' nav (quantecode.com): Quante logo, the products menu, the overview's sections
 *  and the way into the app. Nothing of the AssetraDigital website's own menu. */
export function QuanteHeader() {
  const path = usePathname()
  // quantecode.com/ is the overview (rewritten to /quante); previews and localhost serve it at /quante
  const overview = path === '/' || path === '/quante'
  const to = (id: string) => (overview ? '#' + id : quanteHome('#' + id))
  return (
    <FloatingNav
      label="Menu Quante"
      logo={
        <SmartLink className="logo" href={overview ? '#top' : quanteHome()} aria-label="Quante, přehled produktů">
          <AdMark />
          <span className="wm">Quante</span>
        </SmartLink>
      }
      links={[
        { href: to('zacit'), label: 'Začít', num: '01' },
        { href: to('propojeni'), label: 'Jak navazují', num: '02' },
        { href: to('cenik'), label: 'Ceník', num: '03' },
      ]}
      extra={<ProductsMenu />}
      menuLead={(close) => <ProductsMenuList close={close} />}
      cta={{ href: quanteApp.dashboard, label: 'Otevřít Quante' }}
      actions={<MotionToggle />}
    />
  )
}
