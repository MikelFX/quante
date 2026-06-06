import { createClient } from '@/lib/supabase/server'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'
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
  if (!product) return <div style={{ padding: '4rem', textAlign: 'center', color: '#666' }}>Product not found.</div>

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)
  const basePath = `/preview/${id}`

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />

      <StoreNavbar manifest={manifest} basePath={basePath} />

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '4rem 2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'start' }}>
          <div style={{
            aspectRatio: '1', background: 'var(--s-surface)', border: '1px solid var(--s-border)',
            borderRadius: 'var(--s-radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {product.images[0] ? (
              <img src={product.images[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontFamily: 'var(--s-font-heading)', fontSize: '3rem', fontWeight: 700, color: 'var(--s-muted)' }}>
                {product.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(1.75rem,4vw,2.5rem)', fontWeight: 700, marginBottom: '0.75rem' }}>
                {product.name}
              </h1>
              <p style={{ fontFamily: 'var(--s-font-heading)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--s-accent)' }}>
                {manifest.catalog.currency} {product.price.toFixed(2)}
              </p>
            </div>
            <p style={{ color: 'var(--s-muted)', lineHeight: 1.75 }}>{product.description}</p>
            <button style={{
              padding: '1rem 2.5rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)',
              border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 600, fontSize: '1rem',
              fontFamily: 'var(--s-font-body)', cursor: 'pointer', alignSelf: 'flex-start',
            }}>
              Add to cart
            </button>
          </div>
        </div>

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
  )
}
