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

  // ── next-env.d.ts ─────────────────────────────────────────────────────────
  add('next-env.d.ts', `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`)

  // ── app/globals.css ───────────────────────────────────────────────────────
  add('app/globals.css', `@import "tailwindcss";\n\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { -webkit-font-smoothing: antialiased; }\n`)

  // ── app/layout.tsx ────────────────────────────────────────────────────────
  const lang = manifest.catalog.currency === 'CZK' ? 'cs' : 'en'
  add('app/layout.tsx', `\
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { manifest } from '@/data/manifest'
import { CartProvider } from '@/context/cart'
import './globals.css'

export const metadata: Metadata = {
  title: manifest.seo.title,
  description: manifest.seo.description,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="${lang}">
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
import React from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'
import { AddToCartButton } from '@/components/storefront/AddToCartButton'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) return {}
  return { title: \`\${product.name} – \${manifest.seo.title}\`, description: product.description }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = manifest.catalog.products.find((p) => p.slug === slug)
  if (!product) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: manifest.catalog.currency,
      availability: product.available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: manifest.brand.name },
    },
  }

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.25rem 0.625rem', borderRadius: 99, fontSize: '0.8125rem', fontWeight: 600,
                background: product.available ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                color: product.available ? '#059669' : '#dc2626',
                border: \`1px solid \${product.available ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}\`,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: product.available ? '#34d399' : '#f87171', display: 'inline-block' }} />
                {product.available ? 'Skladem' : 'Vyprodáno'}
              </span>
              {product.available && (
                <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>Expedice 1–2 pracovní dny</span>
              )}
            </div>
            <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75 }}>{product.description}</p>
            <AddToCartButton
              productId={product.id}
              name={product.name}
              price={product.price}
              currency={manifest.catalog.currency}
              image={product.images[0]}
              available={product.available}
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

  // ── app/[slug]/page.tsx — catch-all for custom pages ─────────────────────
  add('app/[slug]/page.tsx', `\
import { notFound } from 'next/navigation'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'
import { SectionRenderer } from '@/components/storefront/SectionRenderer'

interface Props { params: Promise<{ slug: string }> }

export default async function CustomPage({ params }: Props) {
  const { slug } = await params
  const page = manifest.customPages?.find((p) => p.slug === slug)
  if (!page) notFound()

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        {page.sections.map((section, i) => (
          <SectionRenderer key={i} section={section} manifest={manifest} />
        ))}
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
}

export function generateStaticParams() {
  return (manifest.customPages ?? []).map((p) => ({ slug: p.slug }))
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
  addFile('components/storefront/CookieConsent.tsx', path.join(sfBase, 'CookieConsent.tsx'))

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
      Košík
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
  available?: boolean
}

export function AddToCartButton({ productId, name, price, currency, image, available = true }: Props) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)

  function handleAdd() {
    if (!available) return
    add({ id: productId, name, price, currency, image })
    setAdded(true)
    setTimeout(() => setAdded(false), 1500)
  }

  if (!available) {
    return (
      <button
        disabled
        style={{
          padding: '1rem 2.5rem',
          background: 'var(--s-surface)',
          color: 'var(--s-muted)',
          border: '1px solid var(--s-border)',
          borderRadius: 'var(--s-radius)',
          fontWeight: 600,
          fontSize: '1rem',
          fontFamily: 'var(--s-font-body)',
          cursor: 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        Vyprodáno
      </button>
    )
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
      {added ? '\\u2713 Přidáno do košíku' : 'Přidat do košíku'}
    </button>
  )
}
`)

  // ── app/cart/page.tsx ──────────────────────────────────────────────────────
  add('app/cart/page.tsx', `'use client'
import React, { useState, useEffect, useRef } from 'react'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

const SHIPPING_LABELS: Record<string, string> = {
  zasilkovna: 'Zásilkovna',
  ppl: 'PPL — doručení na adresu',
  dpd: 'DPD — doručení na adresu',
  balikovna: 'Balíkovna',
  osobni_odber: 'Osobní odběr',
  custom: 'Doprava',
}

const PAYMENT_LABELS: Record<string, string> = {
  comgate: 'Platba online (karta, Apple Pay, bankovní tlačítka)',
  gopay: 'Platba online (GoPay)',
  stripe: 'Platba kartou',
  dobirka: 'Dobírka',
  prevod: 'Bankovní převod',
}

export default function CartPage() {
  const { items, updateQty, remove, total, clear } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)

  const shippingMethods = manifest.shipping?.methods ?? []
  const paymentProviders = manifest.payments?.providers ?? []
  const hasDobirka = manifest.payments?.dobirka?.enabled ?? false
  const dobirkaSurcharge = manifest.payments?.dobirka?.priplatek_czk ?? 0
  const hasPrevod = manifest.payments?.prevod?.enabled ?? false
  const freeShippingThreshold = manifest.shipping?.doprava_zdarma_od_czk ?? 0

  const allPaymentOptions = [
    ...paymentProviders.map((p) => ({ key: p, label: PAYMENT_LABELS[p] ?? p })),
    ...(hasDobirka ? [{ key: 'dobirka', label: PAYMENT_LABELS.dobirka }] : []),
    ...(hasPrevod ? [{ key: 'prevod', label: PAYMENT_LABELS.prevod }] : []),
    // If merchant hasn't configured any payment methods yet, fall back to bank transfer
    ...(!paymentProviders.length && !hasDobirka && !hasPrevod ? [{ key: 'prevod', label: PAYMENT_LABELS.prevod }] : []),
  ]

  const defaultShipping = shippingMethods[0]?.type ?? ''
  const defaultPayment = allPaymentOptions[0]?.key ?? 'prevod'

  const [selectedShipping, setSelectedShipping] = useState(defaultShipping)
  const [selectedPayment, setSelectedPayment] = useState(defaultPayment)
  const [zasilkovnaId, setZasilkovnaId] = useState('')
  const [zasilkovnaName, setZasilkovnaName] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [addrUlice, setAddrUlice] = useState('')
  const [addrMesto, setAddrMesto] = useState('')
  const [addrPsc, setAddrPsc] = useState('')

  const shippingObj = shippingMethods.find((m) => m.type === selectedShipping)
  const shippingCost = (freeShippingThreshold > 0 && total >= freeShippingThreshold) ? 0 : (shippingObj?.cena_czk ?? 0)
  const dobirkaFee = selectedPayment === 'dobirka' ? dobirkaSurcharge : 0
  const orderTotal = total + shippingCost + dobirkaFee
  const currency = items[0]?.currency ?? manifest.catalog.currency

  const needsAddress = selectedShipping !== 'zasilkovna' && selectedShipping !== 'osobni_odber'
  const needsZasilkovna = selectedShipping === 'zasilkovna'

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)
  const zasilkovnaApiKey = process.env.NEXT_PUBLIC_ZASILKOVNA_API_KEY ?? ''

  function openZasilkovnaWidget() {
    // @ts-expect-error Packeta loaded via CDN
    if (!window.Packeta?.Widget?.pick) { alert('Widget se načítá, zkuste znovu.'); return }
    // @ts-expect-error Packeta loaded via CDN
    window.Packeta.Widget.pick(zasilkovnaApiKey, (point: { id: string; name: string } | null) => {
      if (point) { setZasilkovnaId(point.id); setZasilkovnaName(point.name) }
    }, { language: 'cs' })
  }

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (!termsAccepted) { setError('Potvrďte prosím souhlas s obchodními podmínkami.'); return }
    if (needsZasilkovna && !zasilkovnaId) { setError('Vyberte výdejní místo Zásilkovny.'); return }
    if (!customerEmail) { setError('Zadejte e-mailovou adresu.'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          paymentMethod: selectedPayment,
          shippingMethod: selectedShipping,
          shippingCents: Math.round(shippingCost * 100),
          dobirkaCents: Math.round(dobirkaFee * 100),
          zasilkovnaBranchId: zasilkovnaId || undefined,
          zasilkovnaBranchName: zasilkovnaName || undefined,
          customerEmail,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          shippingAddress: needsAddress ? { ulice: addrUlice, mesto: addrMesto, psc: addrPsc } : undefined,
        }),
      })
      const data = await res.json()
      if (data.url) { window.location.href = data.url }
      else { setError(data.error || 'Chyba při odesílání objednávky.'); setLoading(false) }
    } catch {
      setError('Chyba sítě. Zkuste to prosím znovu.')
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.625rem 0.875rem', fontSize: '0.9375rem',
    background: 'var(--s-surface)', border: '1px solid var(--s-border)',
    borderRadius: 'var(--s-radius)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem', display: 'block', color: 'var(--s-text)' }
  const sectionHead: React.CSSProperties = { fontFamily: 'var(--s-font-heading)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.875rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--s-border)' }

  return (
    <div style={{ ...cssVars, background: 'var(--s-bg)', color: 'var(--s-text)', fontFamily: 'var(--s-font-body)', minHeight: '100vh' } as React.CSSProperties}>
      {needsZasilkovna && (
        <script src="https://widget.packeta.com/v6/www/js/library.js" async />
      )}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontUrl} />
      <StoreNavbar manifest={manifest} />
      <main style={{ maxWidth: '62rem', margin: '0 auto', padding: 'calc(4rem * var(--s-space)) 2rem' }}>
        <h1 style={{ fontFamily: 'var(--s-font-heading)', fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '2rem' }}>
          Košík
        </h1>

        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 0', color: 'var(--s-muted)' }}>
            <p style={{ marginBottom: '1.5rem', fontSize: '1rem' }}>Váš košík je prázdný.</p>
            <a href="/" style={{ display: 'inline-block', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9375rem' }}>
              Pokračovat v nákupu
            </a>
          </div>
        ) : (
          <form onSubmit={handleCheckout} style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2.5rem', alignItems: 'start' }}>
            {/* LEFT — items + options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

              {/* Items */}
              <div>
                {/* Free shipping progress bar */}
                {freeShippingThreshold > 0 && total < freeShippingThreshold && (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>Doprava zdarma od {freeShippingThreshold} {currency}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--s-accent)' }}>zbývá {(freeShippingThreshold - total).toFixed(0)} {currency}</span>
                    </div>
                    <div style={{ height: '4px', background: 'var(--s-border)', borderRadius: 99 }}>
                      <div style={{ height: '4px', background: 'var(--s-accent)', borderRadius: 99, width: \`\${Math.min(100, (total / freeShippingThreshold) * 100).toFixed(1)}%\`, transition: 'width 0.4s' }} />
                    </div>
                  </div>
                )}
                {freeShippingThreshold > 0 && total >= freeShippingThreshold && (
                  <div style={{ marginBottom: '1rem', padding: '0.625rem 1rem', background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.2)', borderRadius: 'var(--s-radius)', fontSize: '0.8125rem', color: '#059669', fontWeight: 600 }}>
                    ✓ Doprava zdarma
                  </div>
                )}

                <div style={{ border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', overflow: 'hidden' }}>
                  {items.map((item, i) => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', background: 'var(--s-surface)', borderBottom: i < items.length - 1 ? '1px solid var(--s-border)' : 'none' }}>
                      {item.image && <img src={item.image} alt={item.name} style={{ width: '3rem', height: '3rem', objectFit: 'cover', borderRadius: 'calc(var(--s-radius) / 2)', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.2rem', fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                        <p style={{ color: 'var(--s-muted)', fontSize: '0.8125rem' }}>{item.currency} {item.price.toFixed(2)} ks</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <button type="button" onClick={() => updateQty(item.id, item.quantity - 1)} style={{ width: '1.75rem', height: '1.75rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                        <span style={{ width: '1.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.9375rem' }}>{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(item.id, item.quantity + 1)} style={{ width: '1.75rem', height: '1.75rem', background: 'var(--s-bg)', border: '1px solid var(--s-border)', borderRadius: 'calc(var(--s-radius) / 2)', cursor: 'pointer', color: 'var(--s-text)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                      <p style={{ fontWeight: 700, width: '5rem', textAlign: 'right', flexShrink: 0, fontSize: '0.9375rem' }}>{item.currency} {(item.price * item.quantity).toFixed(2)}</p>
                      <button type="button" onClick={() => remove(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--s-muted)', padding: '0.25rem', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }} aria-label="Odebrat">\\u00d7</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shipping */}
              {shippingMethods.length > 0 && (
                <div>
                  <p style={sectionHead}>Způsob doručení</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {shippingMethods.map((method) => {
                      const effectiveCost = freeShippingThreshold > 0 && total >= freeShippingThreshold ? 0 : method.cena_czk
                      return (
                        <label key={method.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', border: \`1px solid \${selectedShipping === method.type ? 'var(--s-accent)' : 'var(--s-border)'}\`, borderRadius: 'var(--s-radius)', cursor: 'pointer', background: 'var(--s-surface)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input type="radio" name="shipping" value={method.type} checked={selectedShipping === method.type} onChange={() => { setSelectedShipping(method.type); setZasilkovnaId(''); setZasilkovnaName('') }} style={{ accentColor: 'var(--s-accent)', margin: 0 }} />
                            <span style={{ fontSize: '0.9375rem', fontWeight: selectedShipping === method.type ? 600 : 400 }}>{SHIPPING_LABELS[method.type] ?? method.nazev ?? method.type}</span>
                          </div>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: effectiveCost === 0 ? '#059669' : 'var(--s-text)' }}>
                            {effectiveCost === 0 ? 'Zdarma' : \`\${effectiveCost} \${currency}\`}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {needsZasilkovna && (
                    <div style={{ marginTop: '0.75rem', padding: '0.875rem 1rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
                      {zasilkovnaId ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem' }}>{zasilkovnaName}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>Pobočka Zásilkovny</p>
                          </div>
                          <button type="button" onClick={openZasilkovnaWidget} style={{ fontSize: '0.8125rem', color: 'var(--s-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Změnit</button>
                        </div>
                      ) : (
                        <button type="button" onClick={openZasilkovnaWidget} style={{ width: '100%', padding: '0.625rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 600, fontSize: '0.9375rem', fontFamily: 'var(--s-font-body)', cursor: 'pointer' }}>
                          Vybrat výdejní místo Zásilkovny
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment */}
              {allPaymentOptions.length > 0 && (
                <div>
                  <p style={sectionHead}>Způsob platby</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {allPaymentOptions.map((opt) => (
                      <label key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', border: \`1px solid \${selectedPayment === opt.key ? 'var(--s-accent)' : 'var(--s-border)'}\`, borderRadius: 'var(--s-radius)', cursor: 'pointer', background: 'var(--s-surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <input type="radio" name="payment" value={opt.key} checked={selectedPayment === opt.key} onChange={() => setSelectedPayment(opt.key)} style={{ accentColor: 'var(--s-accent)', margin: 0 }} />
                          <span style={{ fontSize: '0.9375rem', fontWeight: selectedPayment === opt.key ? 600 : 400 }}>{opt.label}</span>
                        </div>
                        {opt.key === 'dobirka' && dobirkaSurcharge > 0 && (
                          <span style={{ fontSize: '0.875rem', color: 'var(--s-muted)' }}>+{dobirkaSurcharge} {currency}</span>
                        )}
                        {opt.key === 'prevod' && <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)' }}>bez poplatku</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer info */}
              <div>
                <p style={sectionHead}>Kontaktní a dodací údaje</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                    <div>
                      <label style={labelStyle}>Jméno a příjmení</label>
                      <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jan Novák" />
                    </div>
                    <div>
                      <label style={labelStyle}>Telefon</label>
                      <input style={inputStyle} type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+420 777 123 456" />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>E-mail *</label>
                    <input style={inputStyle} type="email" required value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="jan@example.cz" />
                  </div>
                  {needsAddress && (
                    <>
                      <div>
                        <label style={labelStyle}>Ulice a číslo popisné</label>
                        <input style={inputStyle} value={addrUlice} onChange={(e) => setAddrUlice(e.target.value)} placeholder="Příkladná 1" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0.875rem' }}>
                        <div>
                          <label style={labelStyle}>Město</label>
                          <input style={inputStyle} value={addrMesto} onChange={(e) => setAddrMesto(e.target.value)} placeholder="Praha" />
                        </div>
                        <div>
                          <label style={labelStyle}>PSČ</label>
                          <input style={inputStyle} value={addrPsc} onChange={(e) => setAddrPsc(e.target.value)} placeholder="11000" maxLength={6} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — order summary */}
            <div style={{ position: 'sticky', top: '5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', padding: '1.5rem' }}>
                <p style={{ fontFamily: 'var(--s-font-heading)', fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>Shrnutí objednávky</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Zboží ({items.reduce((s, i) => s + i.quantity, 0)} ks)</span>
                    <span>{currency} {total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--s-muted)' }}>Doprava</span>
                    <span style={{ color: shippingCost === 0 ? '#059669' : 'var(--s-text)' }}>
                      {shippingCost === 0 ? 'Zdarma' : \`\${currency} \${shippingCost.toFixed(2)}\`}
                    </span>
                  </div>
                  {dobirkaFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ color: 'var(--s-muted)' }}>Dobírka</span>
                      <span>{currency} {dobirkaFee.toFixed(2)}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.875rem', borderTop: '1px solid var(--s-border)', fontSize: '1.125rem', fontWeight: 700 }}>
                  <span>Celkem s DPH</span>
                  <span>{currency} {orderTotal.toFixed(2)}</span>
                </div>
                {manifest.merchant?.platce_dph && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--s-border)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>
                      <span>Základ daně (bez DPH)</span>
                      <span>{currency} {(orderTotal / 1.21).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--s-muted)' }}>
                      <span>DPH 21 %</span>
                      <span>{currency} {(orderTotal - orderTotal / 1.21).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} style={{ marginTop: '2px', accentColor: 'var(--s-accent)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', lineHeight: 1.5 }}>
                  Souhlasím s <a href="/obchodni-podminky" style={{ color: 'var(--s-accent)', textDecoration: 'none' }}>obchodními podmínkami</a> a beru na vědomí <a href="/ochrana-osobnich-udaju" style={{ color: 'var(--s-accent)', textDecoration: 'none' }}>zásady ochrany osobních údajů</a>.
                </span>
              </label>

              {error && <p style={{ fontSize: '0.875rem', color: '#f87171', margin: 0 }}>{error}</p>}

              <button
                type="submit"
                disabled={loading || !termsAccepted}
                style={{ padding: '1rem 2rem', background: termsAccepted ? 'var(--s-accent)' : 'var(--s-border)', color: termsAccepted ? 'var(--s-accent-text)' : 'var(--s-muted)', border: 'none', borderRadius: 'var(--s-radius)', fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--s-font-body)', cursor: loading || !termsAccepted ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'all 0.2s', lineHeight: 1.3, textAlign: 'center' as const }}
              >
                {loading ? 'Odesílám…' : 'Objednat s povinností platby'}
              </button>

              <p style={{ fontSize: '0.75rem', color: 'var(--s-muted)', textAlign: 'center' as const, lineHeight: 1.5 }}>
                Stisknutím tlačítka odesíláte závaznou objednávku.
              </p>
            </div>
          </form>
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

export async function POST(request: Request) {
  const quanteUrl = process.env.QUANTE_API_URL ?? 'https://quante.vercel.app'
  const projectId = process.env.QUANTE_PROJECT_ID

  if (!projectId) {
    return NextResponse.json({ error: 'Store not configured.' }, { status: 500 })
  }

  const body = await request.json()
  if (!body?.items?.length) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
  }

  const res = await fetch(\`\${quanteUrl}/api/store/checkout\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, ...body }),
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
`)

  // ── app/success/page.tsx ───────────────────────────────────────────────────
  add('app/success/page.tsx', `'use client'
import React, { useEffect, useState } from 'react'
import { useCart } from '@/context/cart'
import { manifest } from '@/data/manifest'
import { manifestToCssVars, buildFontUrl } from '@/components/storefront/tokens'
import { StoreNavbar } from '@/components/storefront/layout/StoreNavbar'
import { StoreFooter } from '@/components/storefront/layout/StoreFooter'

export default function SuccessPage() {
  const { clear } = useCart()
  const [method, setMethod] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [qr, setQr] = useState('')
  const [amount, setAmount] = useState('')
  const [acc, setAcc] = useState('')
  const [qrSrc, setQrSrc] = useState('')

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setMethod(p.get('method') ?? '')
    setOrderNumber(p.get('order') ?? '')
    setQr(p.get('qr') ?? '')
    setAmount(p.get('amount') ?? '')
    setAcc(p.get('acc') ? decodeURIComponent(p.get('acc')!) : '')
    clear()
  }, [])

  useEffect(() => {
    if (method === 'prevod' && qr) {
      setQrSrc(\`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=\${qr}\`)
    }
  }, [method, qr])

  const cssVars = manifestToCssVars(manifest)
  const fontUrl = buildFontUrl(manifest)

  const isPrevod = method === 'prevod'
  const isDobirka = method === 'dobirka'

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
          Objednávka přijata!
        </h1>
        {orderNumber && (
          <p style={{ color: 'var(--s-muted)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            Číslo objednávky: <strong style={{ color: 'var(--s-text)', fontFamily: 'monospace' }}>{orderNumber}</strong>
          </p>
        )}

        {isPrevod ? (
          <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)', textAlign: 'left' }}>
            <p style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>Platební instrukce</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9375rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--s-muted)' }}>Číslo účtu</span>
                <strong style={{ fontFamily: 'monospace' }}>{acc || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--s-muted)' }}>Částka</span>
                <strong>{amount} {manifest.catalog.currency}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--s-muted)' }}>Variabilní symbol</span>
                <strong style={{ fontFamily: 'monospace' }}>{orderNumber?.replace(/\\D/g, '') ?? ''}</strong>
              </div>
            </div>
            {qrSrc && (
              <div style={{ textAlign: 'center' }}>
                <img src={qrSrc} alt="QR platba" width={180} height={180} style={{ borderRadius: 8 }} />
                <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', marginTop: '0.5rem' }}>Naskenujte v mobilním bankovnictví</p>
              </div>
            )}
            <p style={{ fontSize: '0.8125rem', color: 'var(--s-muted)', marginTop: '1rem', lineHeight: 1.5 }}>
              Zboží expedujeme po připsání platby. Potvrzení objednávky vám přišlo e-mailem.
            </p>
          </div>
        ) : isDobirka ? (
          <div style={{ marginTop: '2rem', padding: '1.25rem 1.5rem', background: 'var(--s-surface)', border: '1px solid var(--s-border)', borderRadius: 'var(--s-radius)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Platba na dobírku</p>
            <p style={{ color: 'var(--s-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Platbu uhradíte při převzetí zásilky. Potvrzení objednávky vám přišlo e-mailem.
            </p>
          </div>
        ) : (
          <p style={{ color: 'var(--s-muted)', fontSize: '1rem', lineHeight: 1.75, marginTop: '1rem', marginBottom: '2.5rem' }}>
            Platba proběhla úspěšně. Potvrzení objednávky vám přišlo e-mailem.
          </p>
        )}

        <a href="/" style={{ display: 'inline-block', marginTop: '2.5rem', padding: '0.875rem 2rem', background: 'var(--s-accent)', color: 'var(--s-accent-text)', borderRadius: 'var(--s-radius)', textDecoration: 'none', fontWeight: 600, fontSize: '1rem' }}>
          Pokračovat v nákupu
        </a>
      </main>
      <StoreFooter manifest={manifest} />
    </div>
  )
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
  const hasZasilkovna = manifest.shipping?.methods?.some((m) => m.type === 'zasilkovna') ?? false
  const envLines = [
    '# ── Quante managed payments (auto-configured when deployed via Quante) ────',
    '# These are set automatically. Only needed for local dev or self-hosting.',
    'QUANTE_API_URL=https://quante.vercel.app',
    'QUANTE_PROJECT_ID=your-project-id',
    'QUANTE_API_KEY=your-api-key',
    '',
    ...(hasZasilkovna ? [
      '# ── Zásilkovna / Packeta widget ──────────────────────────────────────────',
      '# Get your API key at https://client.packeta.com/cs/tools/web-widget',
      'NEXT_PUBLIC_ZASILKOVNA_API_KEY=your-zasilkovna-api-key',
      '',
    ] : []),
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
  orderNumber: string
  customerEmail: string
  customerName: string
  amount: number
  currency: string
  status: string
  paymentStatus: string
  paymentMethod: string
  invoiceUrl: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  paid:      { bg: 'rgba(52,211,153,0.12)', color: '#34d399', label: 'Zaplaceno' },
  pending:   { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24', label: 'Čeká' },
  shipped:   { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa', label: 'Odesláno' },
  cancelled: { bg: 'rgba(248,113,113,0.12)', color: '#f87171', label: 'Zrušeno' },
  refunded:  { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa', label: 'Vráceno' },
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Karta', comgate: 'Online', gopay: 'GoPay',
  dobirka: 'Dobírka', prevod: 'Převod',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [revenue, setRevenue] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shipping, setShipping] = useState<Record<string, { tracking: string; url: string }>>({})
  const [sending, setSending] = useState<string | null>(null)

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

  async function markShipped(orderId: string) {
    const s = shipping[orderId] ?? {}
    setSending(orderId)
    await fetch(\`/api/admin/orders/\${orderId}/ship\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingCode: s.tracking, trackingUrl: s.url }),
    })
    setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: 'shipped' } : o))
    setSending(null)
  }

  if (loading) return <div><h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1.5rem' }}>Objednávky</h1><p style={{ fontSize: 13, color: '#8a8a93' }}>Načítám…</p></div>
  if (error) return <div><h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 1rem' }}>Objednávky</h1><p style={{ fontSize: 13, color: '#f87171' }}>{error}</p></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Objednávky</h1>
        {orders.length > 0 && (
          <p style={{ fontSize: 13, color: '#6b6b78' }}>
            {orders.length} obj. · {orders[0]?.currency ?? ''} {revenue.toFixed(2)} přijato
          </p>
        )}
      </div>
      {orders.length === 0 ? (
        <p style={{ fontSize: 13, color: '#8a8a93' }}>Zatím žádné objednávky.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {orders.map((order) => {
            const s = STATUS_COLORS[order.status] ?? STATUS_COLORS.pending
            const isPaid = order.paymentStatus === 'paid' && order.status !== 'shipped' && order.status !== 'refunded' && order.status !== 'cancelled'
            const sh = shipping[order.id] ?? { tracking: '', url: '' }
            return (
              <div key={order.id} style={{ background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#a0a0b0' }}>{order.orderNumber}</span>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, background: s.bg, color: s.color }}>{s.label}</span>
                      <span style={{ fontSize: 11, color: '#6b6b78' }}>{PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{order.customerName}</p>
                    <p style={{ margin: 0, fontSize: 12, color: '#6b6b78' }}>{order.customerEmail} · {new Date(order.createdAt).toLocaleDateString('cs-CZ')}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{order.currency} {order.amount.toFixed(2)}</span>
                    {order.invoiceUrl && (
                      <a href={order.invoiceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#6f78e6', textDecoration: 'none' }}>Faktura ↗</a>
                    )}
                  </div>
                </div>
                {isPaid && (
                  <div style={{ marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      placeholder="Tracking číslo"
                      value={sh.tracking}
                      onChange={(e) => setShipping((prev) => ({ ...prev, [order.id]: { ...sh, tracking: e.target.value } }))}
                      style={{ padding: '0.4rem 0.75rem', fontSize: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f4f6', width: 160 }}
                    />
                    <input
                      placeholder="Tracking URL (volitelné)"
                      value={sh.url}
                      onChange={(e) => setShipping((prev) => ({ ...prev, [order.id]: { ...sh, url: e.target.value } }))}
                      style={{ padding: '0.4rem 0.75rem', fontSize: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f4f6', flex: 1, minWidth: 160 }}
                    />
                    <button
                      onClick={() => markShipped(order.id)}
                      disabled={sending === order.id}
                      style={{ padding: '0.4rem 1rem', background: '#60a5fa', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', opacity: sending === order.id ? 0.6 : 1 }}
                    >
                      {sending === order.id ? 'Odesílám…' : 'Označit jako odesláno'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
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

export async function GET() {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')
  if (!auth?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const quanteUrl = process.env.QUANTE_API_URL ?? 'https://quante.vercel.app'
  const apiKey = process.env.QUANTE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'QUANTE_API_KEY not configured' }, { status: 400 })

  try {
    const res = await fetch(\`\${quanteUrl}/api/store/orders\`, {
      headers: { Authorization: \`Bearer \${apiKey}\` },
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Fetch error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
`)

  add('app/api/admin/orders/[orderId]/ship/route.ts', `\
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

interface Context { params: Promise<{ orderId: string }> }

export async function POST(request: Request, { params }: Context) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')
  if (!auth?.value) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  const quanteUrl = process.env.QUANTE_API_URL ?? 'https://quante.vercel.app'
  const apiKey = process.env.QUANTE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'QUANTE_API_KEY not configured' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { trackingCode?: string; trackingUrl?: string; useZasilkovna?: boolean; weight?: number }

  // For Zásilkovna orders without a manual tracking code, try the Packeta API
  if (body.useZasilkovna && !body.trackingCode) {
    const zRes = await fetch(\`\${quanteUrl}/api/store/orders/\${orderId}/zasilkovna-shipment\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${apiKey}\` },
      body: JSON.stringify({ weight: body.weight }),
    })
    const zData = await zRes.json()
    if (zRes.ok) return NextResponse.json(zData, { status: 200 })
    // Fall through to manual PATCH if Packeta API not configured
  }

  const res = await fetch(\`\${quanteUrl}/api/store/orders/\${orderId}\`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${apiKey}\` },
    body: JSON.stringify({ status: 'shipped', trackingCode: body.trackingCode, trackingUrl: body.trackingUrl }),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
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
    `| \`QUANTE_API_URL\` | For checkout | Quante platform URL |`,
    `| \`QUANTE_PROJECT_ID\` | For checkout | Your project ID on Quante |`,
    `| \`QUANTE_API_KEY\` | For admin | API key for order access |`,
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
