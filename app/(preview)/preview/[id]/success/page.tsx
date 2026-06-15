import { createClient } from '@/lib/supabase/server'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { MotionProvider } from '@/components/storefront/motion/context'
import type { ShopManifest } from '@/types/manifest'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ order?: string; method?: string }>
}

export default async function SuccessPage({ params, searchParams }: Props) {
  const { id } = await params
  const { order, method } = await searchParams
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
  const isPrevod = method === 'prevod'
  const bankovniUcet = manifest.merchant?.bankovni_ucet

  return (
    <MotionProvider level={manifest.design.motion ?? 'subtle'}>
      <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={fontUrl} />

        <StoreNavbar manifest={manifest} basePath={basePath} />

        <main style={{ maxWidth: '48rem', margin: '0 auto', padding: 'clamp(3rem,8vw,6rem) clamp(1rem,4vw,2rem)', textAlign: 'center' }}>
          {/* Checkmark */}
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#22c55e', margin: '0 auto 1.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 style={{ fontFamily: 'var(--s-font-heading)', fontWeight: 700, fontSize: 'clamp(1.75rem,4vw,2.5rem)', marginBottom: '0.75rem', color: 'var(--s-text)' }}>
            Děkujeme za objednávku!
          </h1>

          {order && (
            <p style={{ fontFamily: 'var(--s-font-body)', color: 'var(--s-muted)', fontSize: '1rem', marginBottom: '0.5rem' }}>
              Číslo objednávky: <strong style={{ color: 'var(--s-text)' }}>{order}</strong>
            </p>
          )}

          <p style={{ fontFamily: 'var(--s-font-body)', color: 'var(--s-muted)', fontSize: '0.9375rem', lineHeight: 1.7, marginBottom: '2rem' }}>
            Potvrzení objednávky jsme vám zaslali na e-mail.
            {isPrevod && bankovniUcet && ` Prosím proveďte platbu na účet ${bankovniUcet}.`}
          </p>

          <a
            href={basePath}
            style={{
              display: 'inline-block', padding: '0.875rem 2rem',
              background: 'var(--s-accent)', color: 'var(--s-accent-text)',
              borderRadius: 'var(--s-radius)', fontWeight: 600,
              fontSize: '1rem', fontFamily: 'var(--s-font-body)',
              textDecoration: 'none',
            }}
          >
            Pokračovat v nákupu
          </a>
        </main>

        <StoreFooter manifest={manifest} basePath={basePath} />
      </div>
    </MotionProvider>
  )
}
