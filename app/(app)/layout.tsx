'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutGrid, Plus, CreditCard, Settings } from 'lucide-react'

const NAV = [
  { href: '/dashboard', icon: LayoutGrid, label: 'Projects' },
  { href: '/new',       icon: Plus,        label: 'New'      },
  { href: '/billing',   icon: CreditCard,  label: 'Billing'  },
  { href: '/settings',  icon: Settings,    label: 'Settings' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', background: 'var(--background)' }}>
      {/* Top bar */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 40,
        height: '3rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 1rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--background)',
        backdropFilter: 'blur(8px)',
      }}>
        <Link href="/dashboard" style={{
          fontFamily: 'var(--font-geist-mono)', fontSize: 13, fontWeight: 600,
          color: 'var(--foreground)', textDecoration: 'none',
        }}>
          quante
        </Link>
      </header>

      {/* Page content */}
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: '4.5rem' }}>
        {children}
      </main>

      {/* Bottom nav */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
        height: '4rem',
        display: 'flex', alignItems: 'stretch',
        borderTop: '1px solid var(--border)',
        background: 'var(--background)',
      }}>
        {NAV.map(({ href, icon: Icon, label }) => (
          <BottomNavItem key={href} href={href} icon={Icon} label={label} />
        ))}
      </nav>
    </div>
  )
}

function BottomNavItem({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))

  return (
    <Link href={href} style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 3,
      textDecoration: 'none',
      color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
      transition: 'color 0.15s',
    }}>
      <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
      <span style={{ fontSize: 10, fontWeight: active ? 600 : 400 }}>{label}</span>
    </Link>
  )
}
