import { QuanteClerk } from '@/components/auth/QuanteClerk'
import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // PublicNav reads the Clerk session (Log in / Dashboard), so these pages load Clerk.
  return (
    <QuanteClerk>
      <div className="qnt-public qp-dark" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <PublicNav />

        <main style={{ flex: 1 }}>
          {children}
        </main>

        <SiteFooter />
      </div>
    </QuanteClerk>
  )
}
