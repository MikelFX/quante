'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { LiquidGlassDefs } from './LiquidGlassDefs'
import { QuanteBrand } from '@/components/shell/QuanteBrand'
import { quanteHref } from '@/lib/domains'

// The nav of the Quante tool pages (Qads, Qscan, Qgent) and the legal pages. Every product is one
// click away (owner 2026-11-04): on phones the links sit in a scrolling row under the bar.
const LINKS = [
  { href: quanteHref('/quante'), label: 'All products' },
  { href: '/qads', label: 'Qads' },
  { href: '/qscan', label: 'Qscan' },
  { href: '/qgent', label: 'Qgent', badge: '20 agents' },
  { href: '/new', label: 'Generate' },
  { href: quanteHref('/quante#cenik'), label: 'Pricing' },
]

// Shared sticky glass nav for every public/marketing page. Deliberately the
// ONLY sticky element on these pages — stacking a sticky nav on top of a
// sticky harness bar was the source of a real mobile bug in the approved
// mockup, so keep it that way here too.
//
// Aware of Clerk auth state: an anonymous visitor sees "Log in" + "Try free";
// a signed-in visitor sees "Dashboard" + a small sign-out link so they can
// jump to the Studio without hitting the URL bar, or sign out and go back to
// the marketing site as an anonymous user.
export function PublicNav() {
  const { isSignedIn, isLoaded } = useUser()
  const { signOut } = useClerk()
  const path = usePathname()
  const current = (href: string) => (href.startsWith('/') && (path === href || path.startsWith(href + '/')) ? 'page' : undefined)

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
        // Translucent shade of the page bg — light and dark public roots
        // both live under `.qnt-public`, and the parent may or may not
        // carry `.qp-dark`. Instead of hardcoding either colour, read the
        // current --qp-bg from the CSS variable so the nav re-tints with
        // the theme automatically. The alpha is layered as a separate
        // linear-gradient overlay so the backdrop-filter blur still gets
        // real background to work against.
        background: 'color-mix(in oklab, var(--qp-bg) 82%, transparent)',
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
        <Link href={quanteHref('/quante')} aria-label="Quante, all products" style={{ display: 'flex', minHeight: 44, alignItems: 'center', textDecoration: 'none' }}>
          <QuanteBrand />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <nav aria-label="Quante products" className="hidden lg:flex" style={{ alignItems: 'center', gap: 22 }}>
            {LINKS.map(l => <NavItem key={l.href} l={l} current={current(l.href)} />)}
          </nav>
          {/* Auth cluster: layout is stable across states (an anonymous
              visitor sees Log in + Try free; a signed-in visitor sees
              Sign out + Dashboard) so the nav's total width doesn't shift
              once Clerk hydrates. */}
          {!isLoaded ? (
            <span style={{ width: 140 }} />
          ) : isSignedIn ? (
            <>
              <button
                type="button"
                className="q-tap"
                onClick={() => signOut({ redirectUrl: '/' })}
                style={{
                  fontSize: 13.5, color: 'var(--qp-sub)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: 0,
                }}
              >
                Sign out
              </button>
              <Link
                href="/dashboard"
                className="q-tap"
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: 'var(--q-acc-ink)',
                  background: 'var(--qp-accent)',
                  padding: '0.5rem 1.1rem',
                  borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}
              >
                Open Studio →
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="q-tap" style={{ fontSize: 13.5, color: 'var(--qp-sub)', textDecoration: 'none' }}>
                Log in
              </Link>
              <Link
                href="/signup"
                className="q-tap"
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: 'var(--q-acc-ink)',
                  background: 'var(--qp-accent)',
                  padding: '0.5rem 1.1rem',
                  borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}
              >
                Try free →
              </Link>
            </>
          )}
        </div>
      </div>
      {/* Phones and tablets: the same links in a row that scrolls sideways */}
      <nav
        aria-label="Quante products"
        className="flex lg:hidden"
        style={{ gap: 18, overflowX: 'auto', padding: '0 1.5rem 10px', scrollbarWidth: 'none', whiteSpace: 'nowrap' }}
      >
        {LINKS.map(l => <NavItem key={l.href} l={l} current={current(l.href)} />)}
      </nav>
    </header>
    </>
  )
}

function NavItem({ l, current }: { l: (typeof LINKS)[number]; current?: 'page' }) {
  return (
    <Link
      href={l.href}
      aria-current={current}
      className="q-tap"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        fontSize: 13.5, textDecoration: 'none',
        color: current ? 'var(--q-fg)' : 'var(--qp-sub)', fontWeight: current ? 600 : 400,
      }}
    >
      {l.label}
      {'badge' in l && l.badge && (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '3px 6px', borderRadius: 99, background: 'var(--qp-accent)', color: 'var(--q-acc-ink)',
        }}>
          {l.badge}
        </span>
      )}
    </Link>
  )
}
