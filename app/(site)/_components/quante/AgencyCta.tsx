import { Button } from '@ad/ui'
import { quanteApp, type Locale } from '@/content/assetra/modules'
import { uiCopy } from './ui-copy'

// The website has no sign-in (Clerk runs only in the Quante app, on its own host — lib/domains.ts),
// so ordering Agency happens in the app: Billing → "Upgrade to Agency" starts the Stripe checkout.
// Signed-out visitors sign in first and land back on Billing.
export function AgencyCta({ locale = 'cs' }: { locale?: Locale }) {
  return (
    <div className="q-agency">
      <Button href={quanteApp.agency} arrow>{uiCopy(locale).orderAgency}</Button>
    </div>
  )
}
