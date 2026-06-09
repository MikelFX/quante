import type { ShopManifest } from '@/types/manifest'
import { manifestToCssVars, buildFontUrl } from './tokens'
import { StoreNavbar } from './layout/StoreNavbar'
import { StoreFooter } from './layout/StoreFooter'
import { SectionRenderer } from './SectionRenderer'

interface Props {
  manifest: ShopManifest
  page?: keyof ShopManifest['pages']
  customSlug?: string
  basePath?: string
}

export function ShopRenderer({ manifest, page = 'home', customSlug, basePath = '' }: Props) {
  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)
  const sections = customSlug
    ? (manifest.customPages?.find((p) => p.slug === customSlug)?.sections ?? [])
    : (manifest.pages[page] ?? [])

  return (
    <div
      style={
        {
          ...cssVars,
          background: 'var(--s-bg)',
          color: 'var(--s-text)',
          fontFamily: 'var(--s-font-body)',
          minHeight: '100vh',
        } as React.CSSProperties
      }
    >
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />

      <StoreNavbar manifest={manifest} basePath={basePath} />

      {sections.map((section, i) => (
        <SectionRenderer key={i} section={section} manifest={manifest} basePath={basePath} />
      ))}

      <StoreFooter manifest={manifest} basePath={basePath} />
    </div>
  )
}
