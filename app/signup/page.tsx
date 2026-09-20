import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'
import { buildMetadata } from '@/lib/seo'

// Signup indexable — this is the "convert" landing for the free-credits
// hook, so search visitors on brand-adjacent queries ("quante signup")
// should land here directly rather than bounce through /.
export const metadata = buildMetadata({
  title: 'Sign up for Quante — 12 free credits',
  description: 'Create a Quante account and get 12 free credits — no card required. Start describing your store and Quante ships the code.',
  path: '/signup',
})

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
