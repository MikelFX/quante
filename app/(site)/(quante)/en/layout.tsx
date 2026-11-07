import { QuanteFooter } from '../../_components/quante/QuanteFooter'
import { QuanteHeader } from '../../_components/quante/QuanteHeader'

/** The English Quante pages (quantecode.com/en, /en/<modul>). lang="en" overrides the website's
 *  lang="cs" wrapper; <html lang> follows the path (lib/lang-script.ts). */
export default function QuanteEnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en">
      <QuanteHeader locale="en" />
      <main>{children}</main>
      <QuanteFooter locale="en" />
    </div>
  )
}
