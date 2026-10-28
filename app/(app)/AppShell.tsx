'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { LayoutGrid, Plus, CreditCard, Settings, Store } from 'lucide-react'
import { CreditPill } from '@/components/shell/CreditPill'
import { AdMark, MotionToggle, ParticleMode, ThemeToggle } from '@ad/ui'
import '@ad/ui/styles/assetra.css'
import './app.css'

const NAV = [
  { href: '/dashboard',    icon: LayoutGrid, label: 'Projects'    },
  { href: '/new',          icon: Plus,       label: 'New'         },
  { href: '/marketplace',  icon: Store,      label: 'Marketplace' },
  { href: '/billing',      icon: CreditCard, label: 'Billing'     },
  { href: '/settings',     icon: Settings,   label: 'Settings'    },
]

/** The app chrome (header, sidebar, Studio frame). Client side; the layout wraps it in Clerk. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isStudio = pathname.startsWith('/project/')

  return (
    // .ad gives the app the AssetraDigital surface (page background, focus ring, design classes);
    // .ad-app keeps it calm: no grain, cursor or bands, particles only in empty / loading states.
    <div className="ad ad-app" style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <ParticleMode mode="app" />

      {/* ── Global header ──────────────────────────────────────────────── */}
      <header className="ad-app-head">
        <Link href="/dashboard" className="ad-app-logo" aria-label="Quante, projects">
          <AdMark />
          <span>Quante</span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isStudio && <CreditPill compact />}
          <MotionToggle lang="en" />
          <ThemeToggle lang="en" />
          <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28 } } }} />
        </div>
      </header>

      {isStudio ? (
        /* ── Studio: fills below header, provides its own chrome ───── */
        <div style={{ flex: 1, overflow: 'hidden' }}>{children}</div>

      ) : (
        /* ── App shell routes ──────────────────────────────────────── */
        <>
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

            {/* Ambient background — two calm, static glows behind all content */}
            <div aria-hidden="true" className="ad-app-ambient">
              <i />
              <i />
            </div>

            {/* Desktop sidebar — hidden on mobile via Tailwind */}
            <aside
              className="ad-app-side hidden lg:flex flex-col"
              style={{ width: 220, flexShrink: 0, position: 'relative', zIndex: 1 }}
            >
              {/* Nav */}
              <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <p className="ad-app-label">workspace</p>
                {NAV.map(({ href, icon: Icon, label }) => {
                  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
                  return (
                    <SidebarLink key={href} href={href} icon={Icon} label={label} active={active} />
                  )
                })}
              </nav>

              {/* Bottom: credits + user */}
              <div style={{
                padding: '12px 14px 16px',
                borderTop: '1px solid rgb(var(--q-ink-rgb) / .07)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <CreditPill />
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <UserButton appearance={{ elements: { avatarBox: { width: 26, height: 26 } } }} />
                  <span style={{
                    fontSize: 12, color: 'var(--q-fg3)',
                    fontFamily: 'var(--q-mono)',
                  }}>
                    account
                  </span>
                </div>
              </div>
            </aside>

            {/* Main content — scrolls independently */}
            <main
              className="flex-1 overflow-y-auto pb-[4.5rem] lg:pb-0"
              style={{ minWidth: 0, position: 'relative', zIndex: 1 }}
            >
              {children}
            </main>
          </div>

          {/* ── Mobile bottom nav — hidden on desktop ──────────────────── */}
          <nav
            className="lg:hidden flex items-stretch"
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
              height: '4rem',
              background: 'rgb(var(--q-bg-rgb) / .95)',
              backdropFilter: 'blur(12px)',
              borderTop: '1px solid rgb(var(--q-ink-rgb) / .07)',
            }}
          >
            {NAV.map(({ href, icon: Icon, label }) => {
              const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
              return (
                <BottomNavItem key={href} href={href} icon={Icon} label={label} active={active} />
              )
            })}
          </nav>
        </>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SidebarLink({
  href, icon: Icon, label, active,
}: {
  href: string
  icon: React.ElementType
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 8,
        textDecoration: 'none', fontSize: 13,
        fontWeight: active ? 550 : 400,
        color: active ? 'var(--q-acc-text)' : 'var(--q-fg3)',
        background: active ? 'rgb(var(--q-acc-rgb) / .1)' : 'transparent',
        transition: 'color 0.12s, background 0.12s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--q-fg)'
          ;(e.currentTarget as HTMLAnchorElement).style.background = 'rgb(var(--q-ink-rgb) / .05)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--q-fg3)'
          ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
        }
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: 3, height: 16, borderRadius: '0 2px 2px 0',
          background: 'var(--q-acc)',
          boxShadow: '0 0 8px rgb(var(--q-acc-rgb) / .5)',
        }} />
      )}
      <Icon size={15} strokeWidth={active ? 2.2 : 1.7} />
      {label}
    </Link>
  )
}

function BottomNavItem({
  href, icon: Icon, label, active,
}: {
  href: string
  icon: React.ElementType
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 3,
        textDecoration: 'none',
        color: active ? 'var(--q-fg)' : 'var(--q-fg3)',
        transition: 'color 0.15s',
        position: 'relative',
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 28, height: 2, borderRadius: '0 0 2px 2px',
          background: 'var(--q-acc)',
          boxShadow: '0 0 8px rgb(var(--q-acc-rgb) / .7)',
        }} />
      )}
      <Icon size={19} strokeWidth={active ? 2.2 : 1.6} />
      <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{label}</span>
    </Link>
  )
}
