import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import path from 'path'
import fs from 'fs'
import type { ShopManifest } from '@/types/manifest'

const EXPORT_COST = 5

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
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
    .eq('user_id', userId)
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
    user_id: userId,
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

    // ── app/collections/[slug]/page.tsx ──────────────────────────────────────
    add('app/collections/[slug]/page.tsx', `\
import { notFound } from 'next/navigation'
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

interface Props { params: Promise<{ slug: string }> }

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params
  const collection = manifest.catalog.collections?.find((c) => c.slug === slug)
  if (!collection) notFound()
  return <ShopRenderer manifest={manifest} page="collection" />
}

export function generateStaticParams() {
  return (manifest.catalog.collections ?? []).map((c) => ({ slug: c.slug }))
}
`)

    // ── app/about/page.tsx ────────────────────────────────────────────────────
    add('app/about/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function AboutPage() {
  return <ShopRenderer manifest={manifest} page="about" />
}
`)

    // ── app/contact/page.tsx ──────────────────────────────────────────────────
    add('app/contact/page.tsx', `\
import { manifest } from '@/data/manifest'
import { ShopRenderer } from '@/components/storefront/ShopRenderer'

export default function ContactPage() {
  return <ShopRenderer manifest={manifest} page="contact" />
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
    addFile('components/storefront/sections/Animations.tsx', path.join(sfBase, 'sections', 'Animations.tsx'))

    // ── data/manifest.ts — baked manifest ────────────────────────────────────
    add('data/manifest.ts', [
      `import type { ShopManifest } from '@/types/manifest'`,
      ``,
      `export const manifest: ShopManifest = ${JSON.stringify(manifest, null, 2)}`,
      ``,
    ].join('\n'))

    // ── .env.example ──────────────────────────────────────────────────────────
    const envLines = [
      '# Stripe — add your keys to enable checkout',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...',
      'STRIPE_SECRET_KEY=sk_live_...',
      '',
      '# Optional: Supabase for a dynamic product catalog',
      '# NEXT_PUBLIC_SUPABASE_URL=',
      '# NEXT_PUBLIC_SUPABASE_ANON_KEY=',
      '',
    ]
    if ((manifest as unknown as Record<string, unknown>).adminPanel === true) {
      envLines.push('# Admin panel — set a strong password')
      envLines.push('ADMIN_PASSWORD=your-admin-password')
      envLines.push('')
    }
    add('.env.example', envLines.join('\n'))

    // ── Admin panel (optional add-on) ─────────────────────────────────────────
    if ((manifest as unknown as Record<string, unknown>).adminPanel === true) {
      addAdminPanelFiles(zip, pre, manifest)
    }

    // ── README.md ─────────────────────────────────────────────────────────────
    const hasAdmin = (manifest as unknown as Record<string, unknown>).adminPanel === true
    const currency = manifest.catalog.currency
    const brandName = manifest.brand.name
    const readmeLines = [
      `# ${brandName}`,
      '',
      `> ${manifest.brand.tagline}`,
      '',
      `Generated with **Quante** — AI-native e-commerce builder.`,
      `Tech stack: **Next.js 16 + TypeScript + Tailwind CSS**.`,
      '',
      '---',
      '',
      '## Quick start',
      '',
      '```bash',
      'npm install',
      'npm run dev',
      '```',
      '',
      'Your store is now running at **http://localhost:3000** — open it in your browser.',
      '',
      '---',
      '',
      '## Environment setup',
      '',
      'Copy the example file and fill in your keys:',
      '',
      '```bash',
      'cp .env.example .env.local',
      '```',
      '',
      'Then edit `.env.local`:',
      '',
      '| Variable | Required | Description |',
      '|---|---|---|',
      `| \`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\` | For checkout | Your Stripe publishable key (starts with \`pk_\`) |`,
      `| \`STRIPE_SECRET_KEY\` | For checkout | Your Stripe secret key (starts with \`sk_\`) |`,
      ...(hasAdmin ? [
        `| \`ADMIN_PASSWORD\` | **Required for admin** | Password to log into /admin panel |`,
      ] : []),
      '',
      '> **Never commit `.env.local` to git.** It is already in `.gitignore`.',
      '',
      '---',
      '',
      '## Stripe checkout setup',
      '',
      '1. Create a free account at [stripe.com](https://stripe.com)',
      '2. Go to **Developers → API keys** in the Stripe dashboard',
      '3. Copy your **Publishable key** and **Secret key**',
      '4. Paste them into `.env.local`',
      '5. Restart the dev server (`npm run dev`)',
      '',
      `The store currency is set to **${currency}** in \`data/manifest.ts\`.`,
      '',
      '---',
      '',
      '## Customizing your store',
      '',
      'All store content is in **`data/manifest.ts`** — this is the single file that drives everything:',
      '',
      '- **Products** — edit `catalog.products` to update names, prices, descriptions, images',
      '- **Colors & fonts** — edit `design.palette` and `design.typography`',
      '- **Page sections** — edit `pages.home`, `pages.product`, etc.',
      '- **Navigation & footer** — edit `nav` and `footer`',
      '- **SEO** — edit `seo.title` and `seo.description`',
      '',
      'Type definitions in `types/manifest.ts` document every available field.',
      '',
      '### Adding product images',
      '',
      'In `data/manifest.ts`, set each product\'s `images` array to public URLs:',
      '',
      '```ts',
      'images: ["https://your-cdn.com/product-photo.jpg"]',
      '```',
      '',
      'Or place images in the `public/` folder and use `/photo.jpg` (relative URL).',
      '',
      '---',
    ]

    if (hasAdmin) {
      readmeLines.push(
        '',
        '## Admin panel',
        '',
        'Your store includes a **professional admin panel** at `/admin`.',
        '',
        '### First-time login',
        '',
        '1. Set your admin password in `.env.local`:',
        '   ```',
        '   ADMIN_PASSWORD=your-strong-password-here',
        '   ```',
        '2. Restart the server',
        '3. Open **http://localhost:3000/admin**',
        '4. Enter the password you set above',
        '',
        '### What you can do in the admin panel',
        '',
        '- **Dashboard** — overview of products, collections, and orders',
        '- **Products** — view, edit, and add products',
        '- **Orders** — manage customer orders (requires Stripe to be configured)',
        '',
        '### On Vercel (production)',
        '',
        'Add `ADMIN_PASSWORD` as an environment variable in your Vercel project settings',
        'before deploying. Choose a strong, unique password.',
        '',
        '> The admin panel is protected by an `admin_auth` cookie (httpOnly, secure).',
        '> The session lasts 7 days.',
        '',
        '---',
      )
    }

    readmeLines.push(
      '',
      '## Deploy to Vercel',
      '',
      '### Option A — Vercel CLI (fastest)',
      '',
      '```bash',
      'npx vercel',
      '```',
      '',
      'Follow the prompts. Your store will be live in ~1 minute.',
      '',
      '### Option B — GitHub import',
      '',
      '1. Push this folder to a new GitHub repository',
      '2. Go to [vercel.com/new](https://vercel.com/new)',
      '3. Import the repository',
      '4. Add your environment variables in the Vercel project settings',
      '5. Click **Deploy**',
      '',
      '### Environment variables on Vercel',
      '',
      'In your Vercel project → **Settings → Environment Variables**, add:',
      '',
      '- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`',
      '- `STRIPE_SECRET_KEY`',
      ...(hasAdmin ? ['- `ADMIN_PASSWORD`'] : []),
      '',
      '---',
      '',
      '## Project structure',
      '',
      '```',
      `${slug}/`,
      '├── app/                    # Next.js App Router pages',
      '│   ├── page.tsx            # Home page',
      '│   ├── products/[slug]/    # Product detail pages',
      '│   ├── collections/[slug]/ # Collection pages',
      '│   ├── about/              # About page',
      '│   ├── contact/            # Contact page',
      ...(hasAdmin ? ['│   └── admin/              # Admin panel'] : []),
      '├── components/storefront/  # Storefront UI components',
      '├── data/manifest.ts        # ← Your store content lives here',
      '├── types/manifest.ts       # TypeScript type definitions',
      '├── .env.example            # Environment variable template',
      '└── README.md               # This file',
      '```',
      '',
      '---',
      '',
      `*${brandName} — built with Quante.*`,
      '',
    )

    add('README.md', readmeLines.join('\n'))

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// ─── Admin panel file generator ───────────────────────────────────────────────

function addAdminPanelFiles(zip: JSZip, pre: string, manifest: ShopManifest) {
  function addAdmin(name: string, content: string) {
    zip.file(pre + name, content)
  }

  // ── app/admin/layout.tsx ────────────────────────────────────────────────────
  addAdmin('app/admin/layout.tsx', `\
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import React from 'react'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')
  const isLoginPage = false // layout wraps all /admin routes except /admin itself
  if (!auth?.value) {
    redirect('/admin')
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh' }}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          {/* Sidebar */}
          <aside style={{ width: 220, flexShrink: 0, background: '#0f0f1a', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', padding: '1.5rem 0' }}>
            <div style={{ padding: '0 1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: '#f4f4f6' }}>Admin</span>
              <p style={{ fontSize: 11, color: '#6b6b78', marginTop: 2 }}>${manifest.brand.name}</p>
            </div>
            <nav style={{ padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[
                { label: 'Dashboard', href: '/admin/dashboard' },
                { label: 'Products', href: '/admin/products' },
                { label: 'Orders', href: '/admin/orders' },
              ].map(({ label, href }) => (
                <a key={href} href={href} style={{ display: 'block', padding: '0.625rem 1.25rem', fontSize: 13, color: '#a0a0b0', textDecoration: 'none', borderRadius: 0 }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(111,120,230,0.08)'; (e.currentTarget as HTMLAnchorElement).style.color = '#f4f4f6' }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = '#a0a0b0' }}
                >
                  {label}
                </a>
              ))}
            </nav>
            <div style={{ marginTop: 'auto', padding: '1rem 1.25rem' }}>
              <form action="/api/admin/auth" method="DELETE">
                <button type="submit" style={{ width: '100%', padding: '0.5rem', fontSize: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#6b6b78', cursor: 'pointer' }}>
                  Sign out
                </button>
              </form>
            </div>
          </aside>
          {/* Main */}
          <main style={{ flex: 1, padding: '2rem', minWidth: 0 }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
`)

  // ── app/admin/page.tsx (login) ──────────────────────────────────────────────
  addAdmin('app/admin/page.tsx', `\
'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/admin/dashboard')
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Invalid password.')
    }
    setLoading(false)
  }

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 360, padding: '0 1rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Admin</h1>
            <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>${manifest.brand.name} — store management</p>
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#a0a0b0', marginBottom: 6 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                style={{ width: '100%', padding: '0.75rem 0.875rem', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f4f4f6', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{ padding: '0.75rem', background: '#6f78e6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </body>
    </html>
  )
}
`)

  // ── app/admin/dashboard/page.tsx ────────────────────────────────────────────
  addAdmin('app/admin/dashboard/page.tsx', `\
import { manifest } from '@/data/manifest'

export default function DashboardPage() {
  const productCount = manifest.catalog.products.length
  const availableCount = manifest.catalog.products.filter((p) => p.available).length

  const cards = [
    { label: 'Total products', value: productCount, href: '/admin/products' },
    { label: 'Available', value: availableCount, href: '/admin/products' },
    { label: 'Orders', value: '—', href: '/admin/orders' },
    { label: 'Collections', value: manifest.catalog.collections?.length ?? 0, href: '/admin/products' },
  ]

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Dashboard</h1>
        <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>Welcome back to ${manifest.brand.name} admin.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {cards.map(({ label, value, href }) => (
          <a key={label} href={href} style={{ display: 'block', textDecoration: 'none', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
            <p style={{ fontSize: 11, color: '#6b6b78', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>{label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: '#f4f4f6', margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
          </a>
        ))}
      </div>

      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.5rem' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 1rem' }}>Quick actions</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            { label: 'Manage products', href: '/admin/products' },
            { label: 'View orders', href: '/admin/orders' },
          ].map(({ label, href }) => (
            <a key={href} href={href} style={{ padding: '0.5rem 1rem', background: 'rgba(111,120,230,0.12)', border: '1px solid rgba(111,120,230,0.25)', borderRadius: 6, color: '#6f78e6', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
`)

  // ── app/admin/products/page.tsx ─────────────────────────────────────────────
  addAdmin('app/admin/products/page.tsx', `\
import { manifest } from '@/data/manifest'

export default function ProductsPage() {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Products</h1>
          <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>{manifest.catalog.products.length} products</p>
        </div>
        <a href="/admin/products/new/edit" style={{ padding: '0.625rem 1.25rem', background: '#6f78e6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          Add product
        </a>
      </div>

      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Name', 'Price', 'Status', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontSize: 11, color: '#6b6b78', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {manifest.catalog.products.map((product) => (
              <tr key={product.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '1rem 1.25rem' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#f4f4f6', margin: '0 0 2px' }}>{product.name}</p>
                    <p style={{ fontSize: 11, color: '#6b6b78', margin: 0 }}>{product.slug}</p>
                  </div>
                </td>
                <td style={{ padding: '1rem 1.25rem', fontSize: 14, color: '#f4f4f6' }}>
                  {manifest.catalog.currency} {product.price.toFixed(2)}
                </td>
                <td style={{ padding: '1rem 1.25rem' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 500, background: product.available ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)', color: product.available ? '#34d399' : '#f87171' }}>
                    {product.available ? 'Available' : 'Unavailable'}
                  </span>
                </td>
                <td style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a href={\`/admin/products/\${product.id}/edit\`} style={{ padding: '4px 12px', fontSize: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f4f6', textDecoration: 'none' }}>Edit</a>
                    <a href={\`/products/\${product.slug}\`} target="_blank" style={{ padding: '4px 12px', fontSize: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#6b6b78', textDecoration: 'none' }}>View</a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
`)

  // ── app/admin/products/[id]/edit/page.tsx ───────────────────────────────────
  addAdmin('app/admin/products/[id]/edit/page.tsx', `\
'use client'

import { useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { manifest } from '@/data/manifest'

export default function EditProductPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const initial = manifest.catalog.products.find((p) => p.id === id)

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [price, setPrice] = useState(String(initial?.price ?? ''))
  const [available, setAvailable] = useState(initial?.available ?? true)
  const [imageUrl, setImageUrl] = useState(initial?.images[0] ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  if (!initial && id !== 'new') {
    return (
      <div>
        <p style={{ color: '#f87171', fontSize: 14 }}>Product not found.</p>
        <a href="/admin/products" style={{ color: '#6f78e6', fontSize: 13 }}>Back to products</a>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)

    const method = initial ? 'PATCH' : 'POST'
    const url = initial ? \`/api/admin/products/\${id}\` : '/api/admin/products'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, price: parseFloat(price), available, images: imageUrl ? [imageUrl] : [] }),
    })

    if (res.ok) {
      setSuccess(true)
      setTimeout(() => router.push('/admin/products'), 800)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Save failed.')
    }
    setSaving(false)
  }

  const fieldStyle = { width: '100%', padding: '0.75rem 0.875rem', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f4f4f6', fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }
  const labelStyle = { display: 'block' as const, fontSize: 12, color: '#a0a0b0', marginBottom: 6 }

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/admin/products" style={{ fontSize: 12, color: '#6b6b78', textDecoration: 'none' }}>← Products</a>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0.5rem 0 0.25rem' }}>
          {initial ? \`Edit: \${initial.name}\` : 'New product'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div>
            <label style={labelStyle}>Price ({manifest.catalog.currency})</label>
            <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Image URL</label>
            <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." style={fieldStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="available" checked={available} onChange={(e) => setAvailable(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#6f78e6' }} />
            <label htmlFor="available" style={{ fontSize: 13, color: '#f4f4f6', cursor: 'pointer' }}>Available for purchase</label>
          </div>

          {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}
          {success && <p style={{ fontSize: 12, color: '#34d399', margin: 0 }}>Saved successfully!</p>}

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="submit" disabled={saving} style={{ flex: 1, padding: '0.75rem', background: '#6f78e6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save product'}
            </button>
            <a href="/admin/products" style={{ padding: '0.75rem 1.25rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#a0a0b0', fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Cancel
            </a>
          </div>
        </div>
      </form>
    </div>
  )
}
`)

  // ── app/admin/orders/page.tsx ───────────────────────────────────────────────
  addAdmin('app/admin/orders/page.tsx', `\
export default function OrdersPage() {
  const hasStripe = !!process.env.STRIPE_SECRET_KEY

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Orders</h1>
        <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>Manage customer orders</p>
      </div>

      {!hasStripe ? (
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,165,0,0.2)', borderRadius: 10, padding: '2rem 1.5rem', maxWidth: 520 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#fbbf24', margin: '0 0 0.75rem' }}>Stripe not configured</p>
          <p style={{ fontSize: 13, color: '#a0a0b0', margin: '0 0 1.25rem', lineHeight: 1.6 }}>
            To view and manage orders, add your Stripe keys to <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>.env.local</code>.
          </p>
          <ol style={{ fontSize: 13, color: '#a0a0b0', lineHeight: 1.8, paddingLeft: '1.25rem', margin: 0 }}>
            <li>Create a <a href="https://stripe.com" target="_blank" style={{ color: '#6f78e6' }}>Stripe account</a></li>
            <li>Copy <code style={{ fontFamily: 'monospace' }}>.env.example</code> → <code style={{ fontFamily: 'monospace' }}>.env.local</code></li>
            <li>Add your <code style={{ fontFamily: 'monospace' }}>STRIPE_SECRET_KEY</code></li>
            <li>Restart the dev server</li>
          </ol>
        </div>
      ) : (
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '2rem', textAlign: 'center', color: '#6b6b78', fontSize: 13 }}>
          <p style={{ margin: '0 0 0.75rem', fontSize: 15, color: '#f4f4f6' }}>Order management ready</p>
          <p style={{ margin: 0 }}>Implement order fetching from Stripe in <code style={{ fontFamily: 'monospace', color: '#a0a0b0' }}>app/api/admin/orders/route.ts</code>.</p>
        </div>
      )}
    </div>
  )
}
`)

  // ── app/api/admin/auth/route.ts ─────────────────────────────────────────────
  addAdmin('app/api/admin/auth/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { password } = await request.json()
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminPassword) {
    return NextResponse.json({ error: 'ADMIN_PASSWORD env var not set.' }, { status: 500 })
  }

  if (password !== adminPassword) {
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set('admin_auth', 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('admin_auth')
  return NextResponse.json({ ok: true })
}
`)

  // ── app/api/admin/products/route.ts ─────────────────────────────────────────
  addAdmin('app/api/admin/products/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { manifest } from '@/data/manifest'

function requireAuth() {
  // Note: in-memory manifest edits are ephemeral in production. For persistent
  // product management, connect a database. This file demonstrates the pattern.
  return true
}

export async function GET() {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ products: manifest.catalog.products })
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  // In production: persist to DB. Here we return the would-be product.
  const newProduct = {
    id: \`p\${Date.now()}\`,
    slug: body.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'new-product',
    name: body.name ?? 'New product',
    description: body.description ?? '',
    price: body.price ?? 0,
    images: body.images ?? [],
    available: body.available ?? true,
    tags: [],
  }
  return NextResponse.json({ product: newProduct }, { status: 201 })
}
`)

  // ── app/api/admin/products/[id]/route.ts ────────────────────────────────────
  addAdmin('app/api/admin/products/[id]/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { manifest } from '@/data/manifest'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const product = manifest.catalog.products.find((p) => p.id === id)
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const body = await request.json()
  // In production: persist to DB. Here we echo the merged object.
  const updated = { ...product, ...body }
  return NextResponse.json({ product: updated })
}

export async function DELETE(request: Request, { params }: Params) {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_auth')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const product = manifest.catalog.products.find((p) => p.id === id)
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // In production: delete from DB.
  return NextResponse.json({ ok: true })
}
`)
}

