'use client'

import { usePathname } from 'next/navigation'
import { AdMark, FloatingNav, MotionToggle, SmartLink } from '@ad/ui'
import { otherLocalePath, quanteApp, quanteHome, type Locale } from '@/content/assetra/modules'
import { quanteHref } from '@/lib/domains'
import { ProductsMenu, ProductsMenuList } from '../ProductsMenu'
import { uiCopy } from './ui-copy'

/** The Quante pages' nav (quantecode.com, English at /en): Quante logo, the products menu, the
 *  overview's sections, the other language and the way into the app. Nothing of the AssetraDigital
 *  website's own menu. */
export function QuanteHeader({ locale = 'cs' }: { locale?: Locale }) {
  const path = usePathname()
  const t = uiCopy(locale)
  // quantecode.com/ is the overview (rewritten to /quante); previews and localhost serve it at /quante
  const overview = locale === 'en' ? path === '/en' : path === '/' || path === '/quante'
  const to = (id: string) => (overview ? '#' + id : quanteHome('#' + id, locale))
  const other = quanteHref(otherLocalePath(path, locale))
  return (
    <FloatingNav
      label={t.navLabel}
      logo={
        <SmartLink className="logo" href={overview ? '#top' : quanteHome('', locale)} aria-label={t.logoLabel}>
          <AdMark />
          <span className="wm">Quante</span>
        </SmartLink>
      }
      links={[
        { href: to('zacit'), label: t.navStart, num: '01' },
        { href: to('propojeni'), label: t.navFlow, num: '02' },
        { href: to('cenik'), label: t.navPricing, num: '03' },
      ]}
      extra={<ProductsMenu locale={locale} />}
      menuLead={(close) => <ProductsMenuList close={close} locale={locale} />}
      cta={{ href: quanteApp.dashboard, label: t.openQuante }}
      actions={
        <>
          {/* A full page load: the other language has its own <html lang> (lib/lang-script.ts). */}
          <a className="ib q-lang" href={other} hrefLang={t.langSwitch.lang} lang={t.langSwitch.lang} aria-label={t.langSwitch.label} title={t.langSwitch.label}>
            {t.langSwitch.short}
          </a>
          <MotionToggle lang={locale} />
        </>
      }
    />
  )
}
