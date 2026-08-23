import { SiteFooter } from '@/components/SiteFooter'
import { PublicNav } from '@/components/public/PublicNav'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="qnt-public" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />

      <main style={{ flex: 1 }}>
        {children}
      </main>

      <SiteFooter />
    </div>
  )
}
