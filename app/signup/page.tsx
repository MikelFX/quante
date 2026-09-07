import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

// No per-page Clerk appearance override here anymore — see app/login/page.tsx
// for why: the whole public site is dark now, matching the root
// ClerkProvider's own dark `appearance` by default.
export default function SignUpPage() {
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
        <SignUp routing="hash" />
      </div>
    </div>
  )
}
