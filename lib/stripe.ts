import Stripe from 'stripe'
export type { CreditPack } from './credit-packs'
export { CREDIT_PACKS } from './credit-packs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2025-01-27.acacia' as any,
})

export function isStripeConfigured(): boolean {
  const key = process.env.STRIPE_SECRET_KEY
  return !!key && key !== 'sk_test_placeholder' && key.startsWith('sk_')
}

// Hosting subscription — create two recurring Prices in Stripe dashboard (currency USD):
//   $99.00 / year   → STRIPE_HOSTING_PRICE_ID
//   $9.99  / month  → STRIPE_HOSTING_MONTHLY_PRICE_ID
export const HOSTING_PRICE_ID = process.env.STRIPE_HOSTING_PRICE_ID ?? ''
export const HOSTING_MONTHLY_PRICE_ID = process.env.STRIPE_HOSTING_MONTHLY_PRICE_ID ?? ''
// Numeric constants moved to lib/config so client components (SubscribeButton,
// StudioClient error paths) can display prices without dragging the Stripe SDK
// into the browser bundle. Re-exported here for backwards compatibility with
// existing server-side call sites that already import them from this module.
export { HOSTING_ANNUAL_USD, HOSTING_MONTHLY_USD } from './config'

// Agency subscription — create a recurring Price ($699/month, USD, monthly)
// and paste the Price ID into STRIPE_AGENCY_PRICE_ID
export const AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID ?? ''
