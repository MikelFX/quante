'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ShopManifest } from '@/types/manifest'
import { CartIcon } from '@/components/storefront/CartIcon'
import { useMotionConfig } from '@/components/storefront/motion/context'

interface Props {
  manifest: ShopManifest
  basePath?: string
}

export function StoreNavbar({ manifest, basePath = '' }: Props) {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const cfg = useMotionConfig()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  return (
    <>
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
            padding: '0 clamp(1rem, 4vw, 2rem)',
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
              fontSize: 'clamp(1rem, 2.5vw, 1.1rem)',
              color: 'var(--s-text)',
              textDecoration: 'none',
              letterSpacing: '0.04em',
            }}
          >
            {manifest.brand.logoText}
          </a>

          {/* Desktop nav */}
          <nav
            style={{
              display: 'flex',
              gap: 'clamp(1rem, 3vw, 2rem)',
              // Hide on small screens via CSS trick using a media-query-equivalent approach
            }}
            className="store-nav-desktop"
          >
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
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CartIcon basePath={basePath} />
            {/* Hamburger — only shown on mobile via CSS */}
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="store-nav-hamburger"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px',
                color: 'var(--s-text)',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                width: 28,
                alignItems: 'flex-end',
              }}
            >
              <span style={{ display: 'block', height: 1.5, background: 'currentColor', borderRadius: 1, width: menuOpen ? '100%' : '100%', transition: 'all 0.2s', transform: menuOpen ? 'rotate(45deg) translate(4.5px, 4.5px)' : 'none' }} />
              <span style={{ display: 'block', height: 1.5, background: 'currentColor', borderRadius: 1, width: menuOpen ? 0 : '70%', transition: 'all 0.2s', opacity: menuOpen ? 0 : 1 }} />
              <span style={{ display: 'block', height: 1.5, background: 'currentColor', borderRadius: 1, width: '100%', transition: 'all 0.2s', transform: menuOpen ? 'rotate(-45deg) translate(4.5px, -4.5px)' : 'none' }} />
            </button>
          </div>
        </div>
      </motion.header>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="store-nav-mobile-menu"
            style={{
              position: 'fixed',
              top: scrolled ? '3.25rem' : '3.75rem',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 49,
              background: 'var(--s-bg)',
              borderTop: '1px solid var(--s-border)',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem clamp(1rem, 4vw, 2rem)',
              gap: '0.25rem',
            }}
          >
            {manifest.nav.map((item) => (
              <a
                key={item.href}
                href={basePath + item.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  color: 'var(--s-text)',
                  textDecoration: 'none',
                  fontSize: 'clamp(1.25rem, 4vw, 1.5rem)',
                  fontWeight: 600,
                  fontFamily: 'var(--s-font-heading)',
                  padding: '0.75rem 0',
                  borderBottom: '1px solid var(--s-border)',
                  display: 'block',
                }}
              >
                {item.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* CSS for desktop/mobile visibility */}
      <style>{`
        .store-nav-desktop { display: flex; }
        .store-nav-hamburger { display: none; }
        .store-nav-mobile-menu { display: none; }
        @media (max-width: 640px) {
          .store-nav-desktop { display: none; }
          .store-nav-hamburger { display: flex; }
          .store-nav-mobile-menu { display: flex; }
        }
      `}</style>
    </>
  )
}
