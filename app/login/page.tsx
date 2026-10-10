import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'
import { QuanteBrand } from '@/components/shell/QuanteBrand'
import { siteHref } from '@/lib/domains'
import { returnTo } from '@/lib/auth/return-to'
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

type Search = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: Search }) {
  // Back to where the visitor came from (e.g. /qads after "Generate") — lib/auth/after-sign-in.ts.
  const to = await returnTo(searchParams)
  return (
    <div className="qnt-public qp-dark" style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1rem', position: 'relative', overflow: 'hidden',
    }}>
      <div className="qp-bg-grid" />
      <div className="qp-bg-scan" />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        <Link href={siteHref('/quante')} aria-label="Quante" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 44, marginBottom: 28, textDecoration: 'none' }}>
          <QuanteBrand size="lg" />
        </Link>
        <SignIn routing="hash" forceRedirectUrl={to} signUpForceRedirectUrl={to} />
      </div>
    </div>
  )
}
