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

// Hosting annual subscription — create a recurring Price in Stripe dashboard
// (€99.00 / year, currency EUR) and paste the Price ID into STRIPE_HOSTING_PRICE_ID
export const HOSTING_PRICE_ID = process.env.STRIPE_HOSTING_PRICE_ID ?? ''
export const HOSTING_ANNUAL_EUR = 99

// Agency subscription — create a recurring Price ($699/month, USD, monthly)
// and paste the Price ID into STRIPE_AGENCY_PRICE_ID
export const AGENCY_PRICE_ID = process.env.STRIPE_AGENCY_PRICE_ID ?? ''
