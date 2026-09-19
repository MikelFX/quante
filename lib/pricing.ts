// Single source of truth for every user-facing pricing string on the
// marketing site. Marketing pages, the homepage pricing preview, the
// /pricing FAQ and the JSON-LD FAQPage schema all pull display strings
// from here — no page composes prices from raw numbers by hand.
//
// Structure:
//   CREDIT_PACKS               — pack ladder (from lib/credit-packs)
//   CREDIT_COSTS               — action costs (from lib/config)
//   HOSTING_*_USD              — hosting subscription (from lib/stripe)
//   AGENCY_MONTHLY_USD         — agency subscription (from lib/config)
//   formatHostingAnnual/Monthly — formatted "$99 / year" / "$9.99 / month"
//   formatAgencyMonthly        — formatted "$699 / month"
//   ACTION_COSTS               — labelled table for the /pricing costs list
//
// The audit brief mandates that "no price or credit number may remain
// hard-coded in JSX or in copy strings". Whenever you write copy that
// mentions a price, import a helper here. If you need a new caption
// shape, add it as a helper; do not inline the computation in a page.

import {
  CREDIT_PACKS,
  getPerCreditDisplay,
  getGenerationsCaption,
  getPackDescription,
  type CreditPack,
} from './credit-packs'
import {
  CREDIT_COSTS,
  AGENCY_MONTHLY_USD,
  HOSTING_ANNUAL_USD,
  HOSTING_MONTHLY_USD,
} from './config'

export {
  CREDIT_PACKS,
  CREDIT_COSTS,
  AGENCY_MONTHLY_USD,
  HOSTING_ANNUAL_USD,
  HOSTING_MONTHLY_USD,
  getPerCreditDisplay,
  getGenerationsCaption,
  getPackDescription,
  type CreditPack,
}

// ─── Hosting / agency captions ──────────────────────────────────────────────

/** "$99 / year" — hosting annual price. */
export function formatHostingAnnual(): string {
  return `$${HOSTING_ANNUAL_USD} / year`
}

/** "$9.99 / month" — hosting monthly price. */
export function formatHostingMonthly(): string {
  return `$${HOSTING_MONTHLY_USD} / month`
}

/** "$99 / year or $9.99 / month" — combined hosting price. */
export function formatHostingBoth(): string {
  return `${formatHostingAnnual()} or ${formatHostingMonthly()}`
}

/** "$699 / month" — agency plan price. */
export function formatAgencyMonthly(): string {
  return `$${AGENCY_MONTHLY_USD} / month`
}

// ─── Action costs table (drives the "What each action costs" list on
//     /pricing and the same list in the FAQ / JSON-LD) ────────────────────

export interface ActionCostRow {
  action: string
  cost: number
  costLabel: string
  freeReason?: string
}

/**
 * The user-facing action-cost table. `cost` is what the ledger actually
 * debits; `costLabel` is what the page renders. Anything that costs 0
 * has a `freeReason` used as a subtitle on /pricing so a visitor
 * understands *why* it's free (part of the "no lock-in" and hosting
 * upsell promises).
 *
 * Deploy is intentionally 0 here: the /api/deploy route gates the
 * action on active hosting subscription instead of a credit charge.
 * Users without hosting are shown an upsell rather than a debit.
 */
export const ACTION_COSTS: ActionCostRow[] = [
  {
    action: 'Build a store from scratch',
    cost: CREDIT_COSTS.generate,
    costLabel: `${CREDIT_COSTS.generate} credits`,
  },
  {
    action: 'Make a change',
    cost: CREDIT_COSTS.iterate,
    costLabel: `${CREDIT_COSTS.iterate} credit`,
  },
  {
    action: 'Redo a section',
    cost: CREDIT_COSTS.section,
    costLabel: `${CREDIT_COSTS.section} credits`,
  },
  {
    action: 'Add a custom component',
    cost: CREDIT_COSTS.custom_component,
    costLabel: `${CREDIT_COSTS.custom_component} credits`,
  },
  {
    action: 'Download the source (ZIP)',
    cost: CREDIT_COSTS.export,
    costLabel: 'Free',
    freeReason: 'Your code is yours — no lock-in.',
  },
  {
    action: 'Deploy to Quante hosting',
    cost: CREDIT_COSTS.deploy,
    costLabel: 'Free with hosting',
    freeReason: 'Included in your hosting subscription. No hosting plan needed if you self-host.',
  },
]
