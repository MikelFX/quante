import { QuanteFooter } from '../../_components/quante/QuanteFooter'
import { QuanteHeader } from '../../_components/quante/QuanteHeader'

/** The Czech Quante pages (quantecode.com/, /quante/<modul>). */
export default function QuanteCsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <QuanteHeader />
      <main>{children}</main>
      <QuanteFooter />
    </>
  )
}
