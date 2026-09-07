import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

// No per-page Clerk appearance override here anymore — the whole public
// site is dark now (approved R1–R6 mockup port), which already matches the
// root ClerkProvider's own dark `appearance` (see app/layout.tsx). Letting
// <SignIn> fall back to that default keeps this page visually consistent
// with the rest of the dark platform instead of carrying its own
// (previously light-glass) theme.
export default function LoginPage() {
  return (
    <div className="qnt-public" style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1rem', position: 'relative', overflow: 'hidden',
    }}>
      <div className="qp-bg-grid" />
      <div className="qp-bg-scan" />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <Link href="/" style={{
          display: 'block', marginBottom: 28, textAlign: 'center',
          fontFamily: 'var(--qp-mono)', fontSize: 14, fontWeight: 600,
          color: 'var(--qp-ink)', textDecoration: 'none', letterSpacing: '-.01em',
        }}>
          quante
        </Link>
        <SignIn routing="hash" />
      </div>
    </div>
  )
}
