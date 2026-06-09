// Build the Next.js source tree for a generated storefront from a ShopManifest.
// Consumed by:
//   - /api/export — wraps the files into a ZIP for download
//   - /api/deploy — uploads the files to Vercel for managed hosting
//
// Output paths are POSIX, relative to the project root (no leading slash, no slug prefix).

import fs from 'fs'
import path from 'path'
import type { ShopManifest } from '@/types/manifest'

export interface GeneratedFile {
  path: string
  content: string
  encoding?: 'utf-8' | 'base64'
}

export function toStoreSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function buildStoreFiles(manifest: ShopManifest): GeneratedFile[] {
  const slug = toStoreSlug(manifest.brand.name) || 'my-store'
  const files: GeneratedFile[] = []
  const cwd = process.cwd()
  const sfBase = path.join(cwd, 'components', 'storefront')

  function add(name: string, content: string) {
    files.push({ path: name, content, encoding: 'utf-8' })
  }

  function addFile(name: string, src: string) {
    files.push({ path: name, content: fs.readFileSync(src, 'utf-8'), encoding: 'utf-8' })
  }

  // ── package.json ──────────────────────────────────────────────────────────
  add('package.json', JSON.stringify({
    name: slug,
    version: '1.0.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: {
      '@stripe/stripe-js': '^9.7.0',
      'lucide-react': '^1.17.0',
      next: '16.2.7',
      react: '19.2.4',
      'react-dom': '19.2.4',
      stripe: '^22.2.0',
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

  // ── next-env.d.ts ─────────────────────────────────────────────────────────
  add('next-env.d.ts', `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`)

  // ── app/globals.css ───────────────────────────────────────────────────────
  add('app/globals.css', `@import "tailwindcss";\n\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { -webkit-font-smoothing: antialiased; }\n`)

  // ── app/layout.tsx ────────────────────────────────────────────────────────
  add('app/layout.tsx', `\
import type { Metadata } from 'next'
import { manifest } from '@/data/manifest'
import { CartProvider } from '@/context/cart'
import './globals.css'

export const metadata: Metadata = {
  title: manifest.seo.title,
  description: manifest.seo.description,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CartProvider>{children}</CartProvider>
      </body>
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
import { AddToCartButton } from '@/components/storefront/AddToCartButton'

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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'calc(3rem * var(--s-space))', alignItems: 'start' }}>
          <div style={{
            aspectRatio: '1', background: 'var(--s-surface)',
            border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)',
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {product.images[0] ? (
              <img src={product.images[0]} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <span style={{ fontFamily: 'var(--s-font-heading)', fontSize: '3rem', fontWeight: 700, color: 'var(--s-muted)' }}>
                {product.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(1.5rem * var(--s-space))' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 700, color: 'var(--s-text)', letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
                {product.name}
              </h1>
              <p style={{ fontFamily: 'var(--s-font-heading)', fontSize: '1.5rem', fontWeight: 600, color: 'var(--s-accent)' }}>
                {manifest.catalog.currency} {product.price.toFixed(2)}
              </p>
            </div>
            <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75 }}>{product.description}</p>
            <AddToCartButton
              productId={product.id}
              name={product.name}
              price={product.price}
              currency={manifest.catalog.currency}
              image={product.images[0]}
            />
          </div>
        </div>

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
  add('components/storefront/layout/StoreNavbar.tsx', `\
import type { ShopManifest } from '@/types/manifest'
import { CartIcon } from '@/components/storefront/CartIcon'

interface Props {
  manifest: ShopManifest
  basePath?: string
}

export function StoreNavbar({ manifest, basePath = '' }: Props) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--s-border)',
        background: 'var(--s-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          padding: '0 2rem',
          height: '3.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <a
          href={basePath || '/'}
          style={{
            fontFamily: 'var(--s-font-heading)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--s-text)',
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
        >
          {manifest.brand.logoText}
        </a>

        <nav style={{ display: 'flex', gap: '2rem' }}>
          {manifest.nav.map((item) => (
            <a
              key={item.href}
              href={basePath + item.href}
              style={{
                color: 'var(--s-muted)',
                textDecoration: 'none',
                fontSize: '0.875rem',
                fontWeight: 500,
                transition: 'color 0.15s',
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <CartIcon basePath={basePath} />
      </div>
    </header>
  )
}
`)
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

  // ── Cart context ──────────────────────────────────────────────────────────
  add('context/cart.tsx', `'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface CartItem {
  id: string
  name: string
  price: number
  currency: string
  quantity: number
  image?: string
}

interface CartContextType {
  items: CartItem[]
  add: (item: Omit<CartItem, 'quantity'>) => void
  updateQty: (id: string, qty: number) => void
  remove: (id: string) => void
  clear: () => void
  count: number
  total: number
}

const CartContext = createContext<CartContextType>({
  items: [], add: () => {}, updateQty: () => {}, remove: () => {}, clear: () => {}, count: 0, total: 0,
})

export const useCart = () => useContext(CartContext)

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  useEffect(() => {
    try {
      const s = localStorage.getItem('cart')
      if (s) setItems(JSON.parse(s))
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(items))
  }, [items])

  function add(item: Omit<CartItem, 'quantity'>) {
    setItems((prev) => {
      const ex = prev.find((i) => i.id === item.id)
      if (ex) return prev.map((i) => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  function updateQty(id: string, qty: number) {
    if (qty <= 0) { setItems((prev) => prev.filter((i) => i.id !== id)); return }
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, quantity: qty } : i))
  }

  function remove(id: string) { setItems((prev) => prev.filter((i) => i.id !== id)) }
  function clear() { setItems([]) }

  const count = items.reduce((s, i) => s + i.quantity, 0)
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0)

  return (
    <CartContext.Provider value={{ items, add, updateQty, remove, clear, count, total }}>
      {children}
    </CartContext.Provider>
  )
}
`)

  // ── CartIcon (navbar) ──────────────────────────────────────────────────────
  add('components/storefront/CartIcon.tsx', `'use client'
import { useCart } from '@/context/cart'

export function CartIcon({ basePath = '' }: { basePath?: string }) {
  const { count } = useCart()
  return (
    <a
      href={basePath + '/cart'}
      style={{
        color: 'var(--s-text)',
        textDecoration: 'none',
        fontSize: '0.8125rem',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
      }}
    >
      Cart
      {count > 0 && (
        <span
          style={{
            background: 'var(--s-accent)',
            color: 'var(--s-accent-text)',
            borderRadius: 99,
            fontSize: '0.6875rem',
            fontWeight: 700,
            padding: '0 0.375rem',
            lineHeight: '1.5',
          }}
        >
          {count}
        </span>
      )}
    </a>
  )
}
`)

  // ── AddToCartButton ────────────────────────────────────────────────────────
  add('components/storefront/AddToCartButton.tsx', `'use client'
import { useState } from 'react'
import { useCart } from '@/context/cart'

interface Props {
  productId: string
  name: string
  price: number
  currency: string
  image?: string
}

export function AddToCartButton({ productId, name, price, currency, image }: Props) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)

  function handleAdd() {
    add({ id: productId, name, price, currency, image })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  return (
    <button
      onClick={handleAdd}
      style={{
        padding: '1rem 2.5rem',
        background: added ? 'var(--s-text)' : 'var(--s-accent)',
        color: added ? 'var(--s-bg)' : 'var(--s-accent-text)',
        border: 'none',
        borderRadius: 'var(--s-radius)',
        fontWeight: 600,
        fontSize: '1rem',
        fontFamily: 'var(--s-font-body)',
        cursor: 'pointer',
        alignSelf: 'flex-start',
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      {added ? '\\u2713 Added to cart' : 'Add to cart'}
    </button>
  )
}
`)

  // ── app/cart/page.tsx ──────────────────────────────────────────────────────
  add('app/cart/page.tsx', `'use client'
import { useState } from 'react'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

export default function CartPage() {
  const { items, updateQty, remove, total } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  async function handleCheckout() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Checkout failed. Please try again.')
        setLoading(false)
      }
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  const currency = items[0]?.currency ?? manifest.catalog.currency

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '52rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '2rem' }}>
          Your cart
        </h1>

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 0', color: 'var(--s-muted)' }}>
            <p style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Your cart is empty.</p>
            <a href="/" style={{ display: 'inline-block', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9375rem' }}>
              Continue shopping
            </a>
          </div>
        ) : (
          <>
            <div style={{ border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', overflow: 'hidden', marginBottom: '2rem' }}>
              {items.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', background: 'var(--s-surface)', borderBottom: i < items.length - 1 ? '1px solid var(--s-border)' : 'none' }}>
                  {item.image && (
                    <img src={item.image} alt={item.name} style={{ width: '3.5rem', height: '3.5rem', objectFit: 'cover', borderRadius: 'calc(var(--s-radius) / 2)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                    <p style={{ color: 'var(--s-muted)', fontSize: '0.8125rem' }}>{item.currency} {item.price.toFixed(2)} each</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <button onClick={() => updateQty(item.id, item.quantity - 1)} style={{ width: '1.875rem', height: '1.875rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                    <span style={{ width: '1.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9375rem' }}>{item.quantity}</span>
                    <button onClick={() => updateQty(item.id, item.quantity + 1)} style={{ width: '1.875rem', height: '1.875rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  </div>
                  <p style={{ fontWeight: 700, width: '5.5rem', textAlign: 'right', flexShrink: 0, fontSize: '0.9375rem' }}>
                    {item.currency} {(item.price * item.quantity).toFixed(2)}
                  </p>
                  <button onClick={() => remove(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s-muted)', padding: '0.25rem', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }} aria-label="Remove">\\u00d7</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1rem' }}>
              {error && <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '22rem', maxWidth: '100%' }}>
                <span style={{ color: 'var(--s-muted)', fontSize: '0.9375rem' }}>Total</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{currency} {total.toFixed(2)}</span>
              </div>
              <button
                onClick={handleCheckout}
                disabled={loading}
                style={{ padding: '0.9375rem 3rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--s-font-body)', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s' }}
              >
                {loading ? 'Redirecting to checkout…' : 'Checkout \\u2192'}
              </button>
            </div>
          </>
        )}
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}
`)

  // ── app/api/checkout/route.ts ─────────────────────────────────────────────
  add('app/api/checkout/route.ts', `\
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

interface CartItem {
  id: string
  name: string
  price: number
  currency: string
  quantity: number
}

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY.' }, { status: 500 })
  }

  const { items } = await request.json() as { items: CartItem[] }
  if (!items?.length) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2026-05-27.dahlia' as '2026-05-27.dahlia' })
  const origin = request.headers.get('origin') || ''

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map((item) => ({
        price_data: {
          currency: item.currency.toLowerCase(),
          product_data: { name: item.name },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: origin + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/cart',
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
`)

  // ── app/success/page.tsx ───────────────────────────────────────────────────
  add('app/success/page.tsx', `'use client'
import { useEffect } from 'react'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

export default function SuccessPage() {
  const { clear } = useCart()
  useEffect(() => { clear() }, [])

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '40rem', margin: '0 auto', padding: 'calc(6rem * var(--s-space)) 2rem', textAlign: 'center' }}>
        <div style={{ width: '4rem', height: '4rem', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', fontSize: '1.5rem', color: '#34d399' }}>
          \\u2713
        </div>
        <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(2rem, 5vw, 2.75rem)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '1rem' }}>
          Order confirmed!
        </h1>
        <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75, marginBottom: '2.5rem' }}>
          Thank you for your purchase. A confirmation email will be sent to you shortly.
        </p>
        <a href="/" style={{ display: 'inline-block', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '1rem' }}>
          Continue shopping
        </a>
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}
`)

  // ── app/api/webhook/route.ts ───────────────────────────────────────────────
  add('app/api/webhook/route.ts', `\
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const stripe = new Stripe(secretKey, { apiVersion: '2026-05-27.dahlia' as '2026-05-27.dahlia' })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const notifyUrl = process.env.QUANTE_NOTIFY_URL
    const notifySecret = process.env.QUANTE_NOTIFY_SECRET

    if (notifyUrl && notifySecret) {
      try {
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + notifySecret },
          body: JSON.stringify({
            sessionId: session.id,
            customerEmail: session.customer_details?.email ?? null,
            customerName: session.customer_details?.name ?? null,
            amount: session.amount_total ? session.amount_total / 100 : 0,
            currency: (session.currency ?? 'usd').toUpperCase(),
          }),
        })
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ received: true })
}
`)

  // ── data/manifest.ts — baked manifest ─────────────────────────────────────
  add('data/manifest.ts', [
    `import type { ShopManifest } from '@/types/manifest'`,
    ``,
    `export const manifest: ShopManifest = ${JSON.stringify(manifest, null, 2)}`,
    ``,
  ].join('\n'))

  // ── .env.example ──────────────────────────────────────────────────────────
  const hasAdmin = (manifest as unknown as Record<string, unknown>).adminPanel === true
  const envLines = [
    '# Stripe — required for checkout',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...',
    'STRIPE_SECRET_KEY=sk_live_...',
    'STRIPE_WEBHOOK_SECRET=whsec_...',
    '',
    '# Order notifications (auto-configured on Quante-hosted stores)',
    '# QUANTE_NOTIFY_URL=https://your-quante-app.com/api/notify/order',
    '# QUANTE_NOTIFY_SECRET=your-per-store-secret',
    '',
    '# Optional: Supabase for a dynamic product catalog',
    '# NEXT_PUBLIC_SUPABASE_URL=',
    '# NEXT_PUBLIC_SUPABASE_ANON_KEY=',
    '',
  ]
  if (hasAdmin) {
    envLines.push('# Admin panel — set a strong password')
    envLines.push('ADMIN_PASSWORD=your-admin-password')
    envLines.push('')
  }
  add('.env.example', envLines.join('\n'))

  // ── .gitignore ────────────────────────────────────────────────────────────
  add('.gitignore', [
    'node_modules', '.next', 'out', '.env*.local', '.DS_Store', '*.log', '',
  ].join('\n'))

  // ── Admin panel (optional add-on) ─────────────────────────────────────────
  if (hasAdmin) {
    addAdminFiles(files, manifest)
  }

  // ── README.md ─────────────────────────────────────────────────────────────
  add('README.md', buildReadme(manifest, hasAdmin, slug))

  return files
}

// ─── Admin panel files ────────────────────────────────────────────────────────

function addAdminFiles(files: GeneratedFile[], manifest: ShopManifest) {
  function add(name: string, content: string) {
    files.push({ path: name, content, encoding: 'utf-8' })
  }

  // Protected layout — wraps /admin/dashboard, /admin/products, /admin/orders
  // Route group (protected) keeps URLs clean (/admin/dashboard etc.) while
  // separating the auth-gated layout from the public login page.
  add('app/admin/(protected)/layout.tsx', `\
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import React from 'react'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')
  if (!auth?.value) redirect('/admin')

  return (
    <div style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh' }}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
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
              <a key={href} href={href} style={{ display: 'block', padding: '0.625rem 1.25rem', fontSize: 13, color: '#a0a0b0', textDecoration: 'none' }}>
                {label}
              </a>
            ))}
          </nav>
          <div style={{ marginTop: 'auto', padding: '1rem 1.25rem' }}>
            <form action="/api/admin/signout" method="POST">
              <button type="submit" style={{ width: '100%', padding: '0.5rem', fontSize: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#6b6b78', cursor: 'pointer' }}>
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main style={{ flex: 1, padding: '2rem', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}
`)

  // Login page — not inside (protected), so not wrapped by auth layout
  add('app/admin/page.tsx', `\
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
    <div style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#080810', color: '#f4f4f6', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 360, padding: '0 1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 0.25rem' }}>Admin</h1>
          <p style={{ fontSize: 13, color: '#6b6b78', margin: 0 }}>${manifest.brand.name} — store management</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus placeholder="Password" style={{ width: '100%', padding: '0.75rem 0.875rem', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f4f4f6', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
          {error && <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ padding: '0.75rem', background: '#6f78e6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
`)

  add('app/admin/(protected)/dashboard/page.tsx', `\
import { manifest } from '@/data/manifest'
export default function DashboardPage() {
  const cards = [
    { label: 'Total products', value: manifest.catalog.products.length, href: '/admin/products' },
    { label: 'Available', value: manifest.catalog.products.filter((p) => p.available).length, href: '/admin/products' },
    { label: 'Collections', value: manifest.catalog.collections?.length ?? 0, href: '/admin/products' },
    { label: 'Orders', value: '→', href: '/admin/orders' },
  ]
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 1.5rem' }}>Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
        {cards.map(({ label, value, href }) => (
          <a key={label} href={href} style={{ display: 'block', textDecoration: 'none', background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1.25rem 1.5rem' }}>
            <p style={{ fontSize: 11, color: '#6b6b78', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>{label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: '#f4f4f6', margin: 0 }}>{value}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
`)

  add('app/admin/(protected)/products/page.tsx', `\
import { manifest } from '@/data/manifest'
export default function ProductsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1.5rem' }}>Products</h1>
      <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['Name', 'Price', 'Status'].map((h) => (
                <th key={h} style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontSize: 11, color: '#6b6b78', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {manifest.catalog.products.map((product) => (
              <tr key={product.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '1rem 1.25rem', fontSize: 14 }}>{product.name}</td>
                <td style={{ padding: '1rem 1.25rem', fontSize: 14 }}>{manifest.catalog.currency} {product.price.toFixed(2)}</td>
                <td style={{ padding: '1rem 1.25rem' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, background: product.available ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)', color: product.available ? '#34d399' : '#f87171' }}>
                    {product.available ? 'Available' : 'Unavailable'}
                  </span>
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

  add('app/admin/(protected)/orders/page.tsx', `\
'use client'
import { useEffect, useState } from 'react'

interface Order {
  id: string
  customerEmail: string
  customerName: string
  amount: number
  currency: string
  createdAt: string
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [revenue, setRevenue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/orders')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setOrders(d.orders ?? [])
        setRevenue(d.revenue ?? 0)
      })
      .catch(() => setError('Failed to load orders.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div><h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1.5rem' }}>Orders</h1><p style={{ fontSize: 13, color: '#8a8a93' }}>Loading…</p></div>

  if (error) return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1rem' }}>Orders</h1>
      <p style={{ fontSize: 13, color: '#f87171' }}>{error}</p>
      {error.includes('STRIPE') && <p style={{ fontSize: 12, color: '#6b6b78', marginTop: '0.5rem' }}>Set STRIPE_SECRET_KEY in your environment variables.</p>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Orders</h1>
        {orders.length > 0 && (
          <p style={{ fontSize: 13, color: '#6b6b78' }}>
            {orders.length} order{orders.length !== 1 ? 's' : ''} &middot; {orders[0].currency} {revenue.toFixed(2)} revenue
          </p>
        )}
      </div>
      {orders.length === 0 ? (
        <p style={{ fontSize: 13, color: '#8a8a93' }}>No orders yet.</p>
      ) : (
        <div style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Date', 'Customer', 'Amount', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '0.875rem 1.25rem', textAlign: 'left', fontSize: 11, color: '#6b6b78', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '1rem 1.25rem', fontSize: 13, color: '#8a8a93' }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: '1rem 1.25rem' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{order.customerName}</p>
                    <p style={{ margin: 0, fontSize: 12, color: '#6b6b78' }}>{order.customerEmail}</p>
                  </td>
                  <td style={{ padding: '1rem 1.25rem', fontSize: 14, fontWeight: 600 }}>{order.currency} {order.amount.toFixed(2)}</td>
                  <td style={{ padding: '1rem 1.25rem' }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>Paid</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
`)

  add('app/api/admin/auth/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { password } = await request.json()
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) return NextResponse.json({ error: 'ADMIN_PASSWORD env var not set.' }, { status: 500 })
  if (password !== adminPassword) return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })

  const cookieStore = await cookies()
  cookieStore.set('admin_auth', 'true', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 60 * 60 * 24 * 7, path: '/',
  })
  return NextResponse.json({ ok: true })
}
`)

  add('app/api/admin/signout/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  cookieStore.delete('admin_auth')
  return NextResponse.redirect(new URL('/admin', request.url))
}
`)

  add('app/api/admin/orders/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import Stripe from 'stripe'

export async function GET() {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')
  if (!auth?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 400 })

  try {
    const stripe = new Stripe(key, { apiVersion: '2026-05-27.dahlia' as '2026-05-27.dahlia' })
    const sessions = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.line_items'] })

    const orders = sessions.data
      .filter((s) => s.payment_status === 'paid')
      .map((s) => ({
        id: s.id,
        customerEmail: s.customer_details?.email ?? '—',
        customerName: s.customer_details?.name ?? '—',
        amount: s.amount_total ? s.amount_total / 100 : 0,
        currency: (s.currency ?? 'usd').toUpperCase(),
        createdAt: new Date(s.created * 1000).toISOString(),
      }))

    const revenue = orders.reduce((sum, o) => sum + o.amount, 0)
    return NextResponse.json({ orders, revenue })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stripe error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
`)
}

// ─── README ──────────────────────────────────────────────────────────────────

function buildReadme(manifest: ShopManifest, hasAdmin: boolean, slug: string): string {
  const lines: string[] = [
    `# ${manifest.brand.name}`, '',
    `> ${manifest.brand.tagline}`, '',
    `Generated with **Quante** — AI-native e-commerce builder.`,
    `Tech stack: **Next.js 16 + TypeScript + Tailwind CSS**.`, '',
    '---', '',
    '## Quick start', '',
    '```bash', 'npm install', 'npm run dev', '```', '',
    'Open **http://localhost:3000** in your browser.', '',
    '---', '',
    '## Environment setup', '',
    '```bash', 'cp .env.example .env.local', '```', '',
    '| Variable | Required | Description |',
    '|---|---|---|',
    `| \`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\` | For checkout | Stripe publishable key |`,
    `| \`STRIPE_SECRET_KEY\` | For checkout | Stripe secret key |`,
    `| \`STRIPE_WEBHOOK_SECRET\` | For webhooks | From Stripe webhook dashboard |`,
    ...(hasAdmin ? [`| \`ADMIN_PASSWORD\` | **Required for admin** | Password for /admin |`] : []),
    '', '> Never commit `.env.local`. It is in `.gitignore`.', '', '---', '',
    '## Customizing', '',
    '`data/manifest.ts` is the single source for all content — products, copy, colors, fonts, sections, nav, footer, SEO.',
    'Edit it and refresh. Type definitions are in `types/manifest.ts`.', '', '---',
  ]

  if (hasAdmin) {
    lines.push(
      '', '## Admin panel', '',
      'Your store ships with a professional admin panel at `/admin`.', '',
      '1. Set `ADMIN_PASSWORD` in `.env.local` to a strong password',
      '2. Restart the dev server', '3. Open **http://localhost:3000/admin**',
      '4. Enter your password', '',
      'Features: dashboard, product management, orders view.',
      'Session lasts 7 days via a secure cookie.', '', '---',
    )
  }

  lines.push(
    '', '## Deploy to Vercel', '',
    '```bash', 'npx vercel', '```', '',
    'Or push to GitHub and import at https://vercel.com/new', '', '---',
    '', '## Project structure', '',
    '```', `${slug}/`,
    '├── app/',
    '│   ├── page.tsx', '│   ├── products/[slug]/', '│   ├── collections/[slug]/',
    '│   ├── about/', '│   ├── contact/',
    ...(hasAdmin ? ['│   └── admin/'] : []),
    '├── components/storefront/', '├── data/manifest.ts',
    '├── types/manifest.ts', '└── README.md', '```', '',
    `*${manifest.brand.name} — built with Quante.*`, '',
  )

  return lines.join('\n')
}
