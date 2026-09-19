import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'
import { buildMetadata } from '@/lib/seo'

// noindex on purpose — auth pages have no search-intent value and can
// confuse SERPs into ranking a sign-in over the actual landing page.
// Every marketing route Google should rank is enumerated in sitemap.ts;
// this one isn't.
export const metadata = buildMetadata({
  title: 'Log in to Quante',
  description: 'Sign in to your Quante account to generate, iterate and deploy stores.',
  path: '/login',
  robots: 'noindex',
})

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
