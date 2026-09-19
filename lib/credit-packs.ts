// Credit packs — single source of truth for the pack ladder.
//
// Prices and pack sizes only. Every "$0.XX / credit" caption and every
// "N full store generations" caption is COMPUTED in the helper functions
// below (getPerCreditDisplay, getGenerationsCaption, getPackDescription)
// so the display numbers can never drift from the price numbers by hand
// typo. The pricing page, the homepage pricing preview, the /pricing
// FAQ and the Stripe checkout description all pull display strings via
// lib/pricing.ts, which re-exports these helpers alongside CREDIT_COSTS.
//
// Ladder inverted per audit brief: larger packs are cheaper per credit,
// not more expensive. Values are the brief's confirmed defaults.
//
// Stripe wiring: /api/stripe/checkout creates each session with
// ad-hoc price_data (unit_amount + description), not a pre-created
// Stripe Price ID — so bumping pack.credits here is enough to change
// what a customer receives when they buy. Old checkout Sessions
// completed before this deploy have their credit grant recorded in
// metadata.credits from the pack values in effect at that moment;
// no user data is retroactively touched.

import { CREDIT_COSTS } from './config'

export interface CreditPack {
  id: string
  credits: number
  label: string
  priceCents: number
  priceDisplay: string
  popular?: boolean
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'starter', credits:  50, label: 'Starter', priceCents:  999, priceDisplay: '$9.99' },
  { id: 'builder', credits: 150, label: 'Builder', priceCents: 2499, priceDisplay: '$24.99', popular: true },
  { id: 'studio',  credits: 500, label: 'Studio',  priceCents: 6999, priceDisplay: '$69.99' },
]

/** "$0.XX / credit" caption, computed from priceCents / credits. */
export function getPerCreditDisplay(pack: CreditPack): string {
  const perCredit = pack.priceCents / 100 / pack.credits
  return `$${perCredit.toFixed(2)} / credit`
}

/** "N full store generations" caption, computed from CREDIT_COSTS.generate. */
export function getGenerationsCaption(pack: CreditPack): string {
  const n = Math.floor(pack.credits / CREDIT_COSTS.generate)
  return `${n} full store generation${n === 1 ? '' : 's'}`
}

/** Short pack description used on Stripe product_data + as the card sub-copy. */
export function getPackDescription(pack: CreditPack): string {
  return `${pack.credits} credits — ${getGenerationsCaption(pack)}`
}
