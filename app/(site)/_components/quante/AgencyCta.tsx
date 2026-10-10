import { Button } from '@ad/ui'
import { quanteApp } from '@/content/assetra/modules'

// The website has no sign-in (Clerk runs only in the Quante app, on its own host — lib/domains.ts),
// so ordering Agency happens in the app: Billing → "Upgrade to Agency" starts the Stripe checkout.
// Signed-out visitors sign in first and land back on Billing.
export function AgencyCta() {
  return (
    <div className="q-agency">
      <Button href={quanteApp.agency} arrow>Objednat Agency</Button>
    </div>
  )
}
