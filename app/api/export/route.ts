import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import path from 'path'
import fs from 'fs'
import type { ShopManifest } from '@/types/manifest'

const EXPORT_COST = 5

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: version } = await supabase
    .from('manifest_versions')
    .select('id, manifest')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return NextResponse.json({ error: 'No manifest found for this project.' }, { status: 404 })

  const { data: ledger } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = ledger?.balance_after ?? 0
  if (balance < EXPORT_COST) {
    return NextResponse.json(
      { error: `Insufficient credits. Need ${EXPORT_COST}, have ${balance}.` },
      { status: 402 }
    )
  }

  const manifest = version.manifest as ShopManifest
  let zipBuffer: Buffer

  try {
    zipBuffer = await buildStoreZip(manifest)
  } catch (err) {
    console.error('Export ZIP build failed:', err)
    return NextResponse.json({ error: 'Failed to build export ZIP.' }, { status: 500 })
  }

  // Record export (best-effort)
  const { data: exportRecord } = await supabase
    .from('exports')
    .insert({ project_id: projectId, version_id: version.id, size_bytes: zipBuffer.byteLength })
    .select('id')
    .single()

  await supabase.from('credit_ledger').insert({
    user_id: user.id,
    delta: -EXPORT_COST,
    reason: 'export',
    ref_id: exportRecord?.id ?? null,
    balance_after: balance - EXPORT_COST,
  })

  const slug = toSlug(manifest.brand.name) || 'my-store'

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}.zip"`,
      'Content-Length': String(zipBuffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

// ─── ZIP builder ─────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function buildStoreZip(manifest: ShopManifest): Promise<Buffer> {
    const zip = new JSZip()
    const slug = toSlug(manifest.brand.name) || 'my-store'
    const pre = `${slug}/`
    const cwd = process.cwd()
    const sfBase = path.join(cwd, 'components', 'storefront')

    function add(name: string, content: string) {
      zip.file(pre + name, content)
    }

    function addFile(name: string, src: string) {
      zip.file(pre + name, fs.readFileSync(src))
    }

    // ── package.json ──────────────────────────────────────────────────────────
    add('package.json', JSON.stringify({
      name: slug,
      version: '1.0.0',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: {
        'lucide-react': '^1.17.0',
        next: '16.2.7',
        react: '19.2.4',
        'react-dom': '19.2.4',
      },
      devDependencies: {
        '@tailwindcss/postcss': '^4',
        '@types/node': '^20',
        '@types/react': '^19',
        '@types/react-dom': '^19',
        tailwindcss: '^4',
        typescript: '^5',
      },
    }, null, 2))

    // ── tsconfig.json ─────────────────────────────────────────────────────────
    add('tsconfig.json', JSON.stringify({
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2))

    // ── next.config.ts ────────────────────────────────────────────────────────
    add('next.config.ts', `import type { NextConfig } from 'next'\nconst nextConfig: NextConfig = {}\nexport default nextConfig\n`)

    // ── postcss.config.mjs ────────────────────────────────────────────────────
    add('postcss.config.mjs', `const config = { plugins: { '@tailwindcss/postcss': {} } }\nexport default config\n`)

    // ── app/globals.css ───────────────────────────────────────────────────────
    add('app/globals.css', `@import "tailwindcss";\n\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { -webkit-font-smoothing: antialiased; }\n`)

    // ── app/layout.tsx ────────────────────────────────────────────────────────
    add('app/layout.tsx', `\
import type { Metadata } from 'next'
import { manifest } from '@/data/manifest'
import './globals.css'

export const metadata: Metadata = {
  title: manifest.seo.title,
  description: manifest.seo.description,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`)

    // ── app/page.tsx (home) ───────────────────────────────────────────────────
    add('app/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function HomePage() {
  return <ShopRenderer manifest={manifest} page="home" />
}
`)

    // ── app/products/[slug]/page.tsx ──────────────────────────────────────────
    add('app/products/[slug]/page.tsx', `\
import { notFound } from 'next/navigation'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) notFound()

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

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

      <StoreNavbar manifest={manifest} />

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'calc(3rem * var(--s-space))',
            alignItems: 'start',
          }}
        >
          {/* Product image */}
          <div
            style={{
              aspectRatio: '1',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              borderRadius: 'var(--s-radius)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {product.images[0] ? (
              <img
                src={product.images[0]}
                alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <span
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: '3rem',
                  fontWeight: 700,
                  color: 'var(--s-muted)',
                }}
              >
                {product.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Product info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(1.5rem * var(--s-space))' }}>
            <div>
              <h1
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: 'clamp(2rem, 4vw, 3rem)',
                  fontWeight: 700,
                  color: 'var(--s-text)',
                  letterSpacing: '-0.02em',
                  marginBottom: '0.75rem',
                }}
              >
                {product.name}
              </h1>
              <p
                style={{
                  fontFamily: 'var(--s-font-heading)',
                  fontSize: '1.5rem',
                  fontWeight: 600,
                  color: 'var(--s-accent)',
                }}
              >
                {manifest.catalog.currency} {product.price.toFixed(2)}
              </p>
            </div>

            <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75 }}>
              {product.description}
            </p>

            <button
              style={{
                padding: '1rem 2.5rem',
                background: 'var(--s-accent)',
                color: 'var(--s-accent-text)',
                border: 'none',
                borderRadius: 'var(--s-radius)',
                fontWeight: 600,
                fontSize: '1rem',
                fontFamily: 'var(--s-font-body)',
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              Add to cart
            </button>
          </div>
        </div>

        {/* Product page sections from manifest */}
        {manifest.pages.product.length > 0 && (
          <div style={{ marginTop: 'calc(6rem * var(--s-space))' }}>
            {manifest.pages.product.map((section, i) => (
              <SectionRenderer key={i} section={section} manifest={manifest} />
            ))}
          </div>
        )}
      </main>

      <StoreFooter manifest={manifest} />
    </div>
  )
}

export function generateStaticParams() {
  return manifest.catalog.products.map((p) => ({ slug: p.slug }))
}
`)

    // ── types/manifest.ts — verbatim copy ─────────────────────────────────────
    addFile('types/manifest.ts', path.join(cwd, 'types', 'manifest.ts'))

    // ── storefront components — verbatim copies ───────────────────────────────
    addFile('components/storefront/tokens.ts', path.join(sfBase, 'tokens.ts'))
    addFile('components/storefront/ShopRenderer.tsx', path.join(sfBase, 'ShopRenderer.tsx'))
    addFile('components/storefront/SectionRenderer.tsx', path.join(sfBase, 'SectionRenderer.tsx'))
    addFile('components/storefront/layout/StoreNavbar.tsx', path.join(sfBase, 'layout', 'StoreNavbar.tsx'))
    addFile('components/storefront/layout/StoreFooter.tsx', path.join(sfBase, 'layout', 'StoreFooter.tsx'))
    addFile('components/storefront/sections/Hero.tsx', path.join(sfBase, 'sections', 'Hero.tsx'))
    addFile('components/storefront/sections/ProductGrid.tsx', path.join(sfBase, 'sections', 'ProductGrid.tsx'))
    addFile('components/storefront/sections/FeatureRow.tsx', path.join(sfBase, 'sections', 'FeatureRow.tsx'))
    addFile('components/storefront/sections/Testimonials.tsx', path.join(sfBase, 'sections', 'Testimonials.tsx'))
    addFile('components/storefront/sections/RichText.tsx', path.join(sfBase, 'sections', 'RichText.tsx'))
    addFile('components/storefront/sections/Banner.tsx', path.join(sfBase, 'sections', 'Banner.tsx'))
    addFile('components/storefront/sections/Newsletter.tsx', path.join(sfBase, 'sections', 'Newsletter.tsx'))
    addFile('components/storefront/sections/Gallery.tsx', path.join(sfBase, 'sections', 'Gallery.tsx'))
    addFile('components/storefront/sections/Faq.tsx', path.join(sfBase, 'sections', 'Faq.tsx'))

    // ── data/manifest.ts — baked manifest ────────────────────────────────────
    add('data/manifest.ts', [
      `import type { ShopManifest } from '@/types/manifest'`,
      ``,
      `export const manifest: ShopManifest = ${JSON.stringify(manifest, null, 2)}`,
      ``,
    ].join('\n'))

    // ── .env.example ──────────────────────────────────────────────────────────
    add('.env.example', [
      '# Stripe — add your keys to enable checkout',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...',
      'STRIPE_SECRET_KEY=sk_live_...',
      '',
      '# Optional: Supabase for a dynamic product catalog',
      '# NEXT_PUBLIC_SUPABASE_URL=',
      '# NEXT_PUBLIC_SUPABASE_ANON_KEY=',
      '',
    ].join('\n'))

    // ── README.md ─────────────────────────────────────────────────────────────
    add('README.md', [
      `# ${manifest.brand.name}`,
      '',
      `> ${manifest.brand.tagline}`,
      '',
      'Generated with **Quante** — AI-native e-commerce builder.',
      '',
      '## Getting started',
      '',
      '```bash',
      'npm install',
      'npm run dev',
      '```',
      '',
      'Open [http://localhost:3000](http://localhost:3000) to see your store.',
      '',
      '## Customizing',
      '',
      'All store content lives in `data/manifest.ts`. Edit products, copy, colors,',
      'and typography there. Type definitions in `types/manifest.ts` document every field.',
      '',
      '## Enabling Stripe checkout',
      '',
      '1. Create a [Stripe](https://stripe.com) account',
      '2. Copy `.env.example` → `.env.local` and fill in your keys',
      '3. Add your checkout API routes under `app/api/`',
      '',
      '## Deploy to Vercel',
      '',
      '```bash',
      'npx vercel',
      '```',
      '',
      'Or push to GitHub and import at [vercel.com/new](https://vercel.com/new).',
      '',
    ].join('\n'))

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
