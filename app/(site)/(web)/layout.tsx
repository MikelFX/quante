import { SiteFooter } from '../_components/SiteFooter'
import { SiteHeader } from '../_components/SiteHeader'
import { QgentWidget } from '../_components/qgent/QgentWidget'

/** Public AssetraDigital pages: floating nav on top, footer with the giant wordmark below, the Qgent assistant. */
export default function WebLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <QgentWidget />
    </>
  )
}
