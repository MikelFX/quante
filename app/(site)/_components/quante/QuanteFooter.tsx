import Link from 'next/link'
import { AdMark, BinaryStrip, GiantWordmark, InView, ParticleZone } from '@ad/ui'
import { company } from '@/content/assetra/site'
import { productLinks, quanteApp, quanteHome, type Locale } from '@/content/assetra/modules'
import { appHref, siteHref } from '@/lib/domains'
import { uiCopy } from './ui-copy'

// Quante's own legal pages live in the app (English, app/(marketing)).
const docs = [
  { label: 'Terms', href: appHref('/terms') },
  { label: 'Privacy', href: appHref('/privacy') },
  { label: 'Cookies', href: appHref('/cookies') },
  { label: 'Refund', href: appHref('/refund') },
]

/** Footer of the Quante pages (quantecode.com): every product, the app, the documents, and that
 *  Quante is a product of AssetraDigital (company data from content/assetra/site.ts). */
export function QuanteFooter({ locale = 'cs' }: { locale?: Locale }) {
  const t = uiCopy(locale)
  return (
    <InView as="footer" className="ft" id="paticka">
      <div className="w">
        <div className="ftg">
          <div>
            <a className="logo" href="#top" aria-label={t.footerUp}>
              <AdMark />
              <span className="wm">Quante</span>
            </a>
            <p>{t.footerProductOf} <a href={siteHref('/')}>{company.name}</a>.</p>
          </div>
          <nav className="ftl" aria-labelledby="ft-aplikace">
            <p className="ftk" id="ft-aplikace">{t.footerApp}</p>
            <a href={quanteApp.start}>{t.startFree}</a>
            <a href={quanteApp.dashboard}>{t.footerDashboard}</a>
            <Link href={quanteHome('#cenik', locale)}>{t.navPricing}</Link>
            <a href={siteHref('/web-eshop#kontakt')}>{t.footerCustom}</a>
            <a href={appHref('/qbox')}>{t.footerQbox}</a>
            <a href={appHref('/agent-shops')}>{t.footerAgentShops}</a>
            <a href={appHref('/changelog')}>{t.footerNews}</a>
          </nav>
          <nav className="ftl ftp" aria-labelledby="ft-produkty">
            <p className="ftk" id="ft-produkty">{t.products}</p>
            {productLinks(locale).map((p) => (
              <Link key={p.slug} href={p.href}>
                {p.name}
                {p.badge && <span className={'ftn' + (p.dev ? ' ftn-dev' : '')}>{p.badge}</span>}
              </Link>
            ))}
          </nav>
          <nav className="ftl" aria-labelledby="ft-dokumenty">
            <p className="ftk" id="ft-dokumenty">{t.footerDocs}</p>
            {docs.map((d) => <a key={d.href} href={d.href}>{d.label}</a>)}
          </nav>
        </div>
      </div>
      <div className="w">
        <ParticleZone className="pz-f" shapes={['Q', '@cube']} />
      </div>
      <BinaryStrip text="QUANTE/GENERATE/QSCAN/QGENT/QDIT/QADS/" />
      <GiantWordmark a="QUANTE" b="CODE" />
      <div className="w ftb">
        <span>© 2026 {company.name}</span>
        <a href="#top">{t.footerTop}</a>
      </div>
    </InView>
  )
}
