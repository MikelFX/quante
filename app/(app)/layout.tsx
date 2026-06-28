'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { LayoutGrid, Plus, CreditCard, Settings } from 'lucide-react'
import { CreditPill } from '@/components/shell/CreditPill'

const NAV = [
  { href: '/dashboard', icon: LayoutGrid, label: 'Projects' },
  { href: '/new',       icon: Plus,       label: 'New'      },
  { href: '/billing',   icon: CreditCard, label: 'Billing'  },
  { href: '/settings',  icon: Settings,   label: 'Settings' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isStudio = pathname.startsWith('/project/')

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', background: '#08080a',
    }}>

      {/* ── Global header ──────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        height: '3rem', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 1rem',
        background: 'rgba(8,8,10,.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,.07)',
      }}>
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-geist-mono)',
          fontSize: 13, fontWeight: 700,
          color: '#f4f4f6', textDecoration: 'none',
          letterSpacing: '-.02em',
        }}>
          quante
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isStudio && <CreditPill compact />}
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

            {/* Ambient background layer — fixed, behind all content */}
            <div style={{
              position: 'fixed', inset: 0, zIndex: 0,
              pointerEvents: 'none', overflow: 'hidden',
            }}>
              {/* Blob 1 */}
              <div className="blob-drift1" style={{
                position: 'absolute',
                width: 560, height: 560,
                top: -80, left: 60,
                background: 'radial-gradient(circle,rgba(79,91,213,.14),transparent 66%)',
                borderRadius: '50%',
              }} />
              {/* Blob 2 */}
              <div className="blob-drift2" style={{
                position: 'absolute',
                width: 480, height: 480,
                bottom: -80, right: -40,
                background: 'radial-gradient(circle,rgba(62,207,142,.06),transparent 66%)',
                borderRadius: '50%',
              }} />
              {/* Blob 3 */}
              <div className="blob-drift1r" style={{
                position: 'absolute',
                width: 360, height: 360,
                top: '45%', left: '55%',
                background: 'radial-gradient(circle,rgba(111,120,230,.10),transparent 68%)',
                borderRadius: '50%',
              }} />
              {/* Grain overlay */}
              <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                opacity: 0.025,
              }} />
            </div>

            {/* Desktop sidebar — hidden on mobile via Tailwind */}
            <aside
              className="hidden lg:flex flex-col"
              style={{
                width: 220, flexShrink: 0,
                background: '#0d0d11',
                borderRight: '1px solid rgba(255,255,255,.07)',
                position: 'relative', zIndex: 1,
              }}
            >
              {/* Nav */}
              <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <p style={{
                  fontSize: 10, fontFamily: 'var(--font-geist-mono)',
                  color: '#5b5b64', fontWeight: 600,
                  letterSpacing: '.06em', textTransform: 'uppercase',
                  padding: '4px 12px 10px',
                }}>
                  workspace
                </p>
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
                borderTop: '1px solid rgba(255,255,255,.07)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <CreditPill />
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <UserButton appearance={{ elements: { avatarBox: { width: 26, height: 26 } } }} />
                  <span style={{
                    fontSize: 12, color: '#8a8a93',
                    fontFamily: 'var(--font-geist-mono)',
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
              background: 'rgba(8,8,10,.95)',
              backdropFilter: 'blur(12px)',
              borderTop: '1px solid rgba(255,255,255,.07)',
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
        color: active ? '#6f78e6' : '#8a8a93',
        background: active ? 'rgba(111,120,230,.1)' : 'transparent',
        transition: 'color 0.12s, background 0.12s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLAnchorElement).style.color = '#f4f4f6'
          ;(e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,.05)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLAnchorElement).style.color = '#8a8a93'
          ;(e.currentTarget as HTMLAnchorElement).style.background = 'transparent'
        }
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
          width: 3, height: 16, borderRadius: '0 2px 2px 0',
          background: '#6f78e6',
          boxShadow: '0 0 8px rgba(111,120,230,.5)',
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
        color: active ? '#f4f4f6' : '#8a8a93',
        transition: 'color 0.15s',
        position: 'relative',
      }}
    >
      {active && (
        <span style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 28, height: 2, borderRadius: '0 0 2px 2px',
          background: '#6f78e6',
          boxShadow: '0 0 8px rgba(111,120,230,.7)',
        }} />
      )}
      <Icon size={19} strokeWidth={active ? 2.2 : 1.6} />
      <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{label}</span>
    </Link>
  )
}
