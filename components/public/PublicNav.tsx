'use client'

import Link from 'next/link'
import { LiquidGlassDefs } from './LiquidGlassDefs'

const LINKS = [
  { href: '/showcase', label: 'Showcase' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/domains', label: 'Domains' },
  { href: '/about', label: 'About' },
]

// Shared sticky glass nav for every public/marketing page. Deliberately the
// ONLY sticky element on these pages — stacking a sticky nav on top of a
// sticky harness bar was the source of a real mobile bug in the approved
// mockup, so keep it that way here too.
export function PublicNav() {
  return (
    <>
    <LiquidGlassDefs />
    <header
      style={{
        position: 'sticky',
        // Must offset below the global AnnouncementBanner (also sticky,
        // also top:0) — without this, once a first-time visitor scrolls,
        // this nav and the banner both pin to the same y=0..40px band and
        // overlap, which is almost certainly why clicks on nav links
        // appeared to do nothing (the click was landing on the wrong
        // stacked element, not on the <Link>). --banner-h is 0px once the
        // banner is dismissed, so this collapses back to a plain top:0.
        top: 'var(--banner-h, 0px)',
        zIndex: 100,
        background: 'rgba(250,247,241,.75)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        backdropFilter: 'blur(16px) saturate(160%)',
        borderBottom: '1px solid var(--qp-line-soft)',
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 1.5rem',
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--qp-mono)',
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-.01em',
            color: 'var(--qp-ink)',
            textDecoration: 'none',
          }}
        >
          quante
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          {LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className="hidden sm:block"
              style={{ fontSize: 13.5, color: 'var(--qp-sub)', textDecoration: 'none' }}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/login" style={{ fontSize: 13.5, color: 'var(--qp-sub)', textDecoration: 'none' }}>
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
              color: '#fff',
              background: 'linear-gradient(155deg,var(--qp-accent-light),var(--qp-accent) 55%,var(--qp-accent-deep))',
              boxShadow: '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.12) inset, 0 10px 22px -8px rgba(91,84,240,.55)',
              padding: '0.5rem 1.1rem',
              borderRadius: 99,
              whiteSpace: 'nowrap',
            }}
          >
            Try free →
          </Link>
        </div>
      </div>
    </header>
    </>
  )
}
