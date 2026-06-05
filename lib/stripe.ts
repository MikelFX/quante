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
