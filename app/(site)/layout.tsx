import type { Metadata } from 'next'
import '@ad/ui/styles/assetra.css'
import './site.css'
import { Grain, ParticleMode, PointerFx } from '@ad/ui'
import { SITE_ORIGIN } from '@/lib/domains'
import { QgentWidget } from './_components/qgent/QgentWidget'
import { SectionSizes } from './_components/SectionSizes'
import { siteOgImage } from './_components/seo'

// The website has its own host (lib/domains.ts): canonical and share URLs resolve against it.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: 'Assetra Digital', template: '%s · Assetra Digital' },
  openGraph: { locale: 'cs_CZ', siteName: 'Assetra Digital', images: [siteOgImage] },
  twitter: { card: 'summary_large_image', images: [siteOgImage.url] },
}

/** The AssetraDigital website surface: Czech, full particle background, grain, custom cursor and Qgent. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ad" id="top" lang="cs">
      <ParticleMode mode="site" />
      <Grain />
      <PointerFx />
      {children}
      <QgentWidget />
      <SectionSizes />
    </div>
  )
}
