'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { ShopManifest } from '@/types/manifest'
import { CartIcon } from '@/components/storefront/CartIcon'
import { useMotionConfig } from '@/components/storefront/motion/context'

interface Props {
  manifest: ShopManifest
  basePath?: string
}

export function StoreNavbar({ manifest, basePath = '' }: Props) {
  const [scrolled, setScrolled] = useState(false)
  const cfg = useMotionConfig()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      animate={{
        height: scrolled ? '3.25rem' : '3.75rem',
        boxShadow: scrolled ? '0 1px 20px rgba(0,0,0,0.07)' : '0 0 0px rgba(0,0,0,0)',
      }}
      transition={{ duration: cfg.enabled ? 0.25 : 0, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        borderBottom: '1px solid var(--s-border)',
        background: 'var(--s-bg)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          padding: '0 2rem',
          height: '100%',
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
    </motion.header>
  )
}
