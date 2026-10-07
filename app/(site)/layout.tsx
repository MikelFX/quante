import type { Metadata } from 'next'
import '@ad/ui/styles/assetra.css'
import './site.css'
import { adFontVars } from '@ad/ui/fonts'
import { Grain, ParticleMode, PointerFx } from '@ad/ui'

export const metadata: Metadata = {
  title: { default: 'Assetra Digital', template: '%s · Assetra Digital' },
}

/** The AssetraDigital website surface: Czech, full particle background, grain and custom cursor. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`ad ${adFontVars}`} id="top" lang="cs">
      <ParticleMode mode="site" />
      <Grain />
      <PointerFx />
      {children}
    </div>
  )
}
