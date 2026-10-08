import type { Metadata } from 'next'
import '@ad/ui/styles/assetra.css'
import './site.css'
import { Grain, ParticleMode, PointerFx } from '@ad/ui'
import { QgentWidget } from './_components/qgent/QgentWidget'
import { SectionSizes } from './_components/SectionSizes'

export const metadata: Metadata = {
  title: { default: 'Assetra Digital', template: '%s · Assetra Digital' },
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
