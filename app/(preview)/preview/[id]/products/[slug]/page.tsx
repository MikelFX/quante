import { createClient } from '@/lib/supabase/server'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'
import { ProductDetail } from '@/components/storefront/ProductDetail'
import { MotionProvider } from '@/components/storefront/motion/context'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  params: Promise<{ id: string; slug: string }>
}

export default async function PreviewProductPage({ params }: Props) {
  const { id, slug } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const manifest = data?.manifest as ShopManifest | undefined
  if (!manifest) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>No manifest found.</div>

  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>Produkt nenalezen.</div>

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)
  const basePath = `/preview/${id}`

  return (
    <MotionProvider level={manifest.design.motion ?? 'subtle'}>
      <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={fontUrl} />

        <StoreNavbar manifest={manifest} basePath={basePath} />

        <main style={{ maxWidth: '80rem', margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,2rem)' }}>
          <ProductDetail product={product} currency={manifest.catalog.currency} />

          {manifest.pages.product.length > 0 && (
            <div style={{ marginTop: '5rem' }}>
              {manifest.pages.product.map((section, i) => (
                <SectionRenderer key={i} section={section} manifest={manifest} basePath={basePath} />
              ))}
            </div>
          )}
        </main>

        <StoreFooter manifest={manifest} basePath={basePath} />
      </div>
    </MotionProvider>
  )
}
