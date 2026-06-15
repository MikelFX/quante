import { createClient } from '@/lib/supabase/server'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { CheckoutForm } from '@/components/storefront/CheckoutForm'
import { MotionProvider } from '@/components/storefront/motion/context'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  params: Promise<{ id: string }>
}

export default async function CheckoutPage({ params }: Props) {
  const { id } = await params
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

        <main style={{ maxWidth: '72rem', margin: '0 auto', padding: 'clamp(2rem,5vw,4rem) clamp(1rem,4vw,2rem)' }}>
          <h1 style={{
            fontFamily: 'var(--s-font-heading)', fontWeight: 700,
            fontSize: 'clamp(1.5rem,4vw,2rem)', marginBottom: '2rem',
            color: 'var(--s-text)',
          }}>
            Pokladna
          </h1>

          <CheckoutForm manifest={manifest} projectId={id} basePath={basePath} />
        </main>

        <StoreFooter manifest={manifest} basePath={basePath} />
      </div>
    </MotionProvider>
  )
}
