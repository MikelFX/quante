import Link from 'next/link'
import { SiteFooter } from '@/components/SiteFooter'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#070709', color: '#f4f4f6', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ── Nav ── */}
      <header style={{
        position: 'sticky',
        top: 'var(--banner-h, 0px)',
        left: 0, right: 0, zIndex: 50,
        height: '3.5rem',
        display: 'flex', alignItems: 'center',
        padding: '0 2rem', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        background: 'rgba(7,7,9,.88)', backdropFilter: 'blur(10px)',
      }}>
        <Link href="/" style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em', color: '#f4f4f6', textDecoration: 'none' }}>
          quante
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/showcase" className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Showcase</Link>
          <Link href="/pricing"  className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/about"    className="hidden sm:block" style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>About</Link>
          <Link href="/login"    style={{ fontSize: 13, color: '#8a8a93', textDecoration: 'none' }}>Log in</Link>
          <Link href="/signup" style={{
            fontSize: 13, fontWeight: 600, textDecoration: 'none',
            color: '#070709', background: '#f4f4f6',
            padding: '0.4rem 0.9rem', borderRadius: 6,
          }}>
            Try free →
          </Link>
        </div>
      </header>

      {/* ── Page content ── */}
      <main style={{ flex: 1 }}>
        {children}
      </main>

      <SiteFooter />
    </div>
  )
}
