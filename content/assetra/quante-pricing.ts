// Quante prices for the website, read from the code that charges them — never typed in by hand:
// lib/credit-packs.ts (what Stripe sells), lib/config.ts (what each action debits, hosting,
// Agency) and lib/qads/pricing.ts (Qads). Prices are USD, as Stripe charges them.

import { AGENCY_MONTHLY_USD, CREDIT_COSTS, HOSTING_ANNUAL_USD } from '@/lib/config'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { QADS_GENERATOR_CREDIT_COSTS as QADS } from '@/lib/qads/pricing'
import type { ModuleSlug } from './modules'

/** 1 kredit · 2–4 kredity · 5+ kreditů */
export function kredity(n: number) {
  if (n === 1) return '1 kredit'
  if (n >= 2 && n <= 4) return `${n} kredity`
  return `${n} kreditů`
}

/** 999 → "9,99" (no locale data involved, identical on server and client) */
export function usd(cents: number) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

const free = 'zdarma'
const credits = (n: number) => (n === 0 ? free : kredity(n))
const videoExample = Math.ceil(QADS.videoPerSecond * 5)

export const quantePricing = {
  packs: CREDIT_PACKS.map((p) => ({
    id: p.id,
    credits: p.credits,
    price: usd(p.priceCents),
    perCredit: usd(Math.round(p.priceCents / p.credits)),
    popular: !!p.popular,
  })),
  welcomeCredits: CREDIT_COSTS.welcome_grant,
  costs: [
    { label: 'Vygenerování e-shopu', value: credits(CREDIT_COSTS.generate) },
    { label: 'Úprava v chatu', value: credits(CREDIT_COSTS.iterate) },
    { label: 'Automatické opravy buildu', value: credits(CREDIT_COSTS.fix) },
    { label: 'Ruční úpravy v Qdit', value: free },
    { label: 'AI v Qdit', value: credits(CREDIT_COSTS.iterate) },
    { label: 'Kontrola obchodu v Qgent', value: credits(CREDIT_COSTS.qgent_review) },
    { label: 'Změna od Qgent', value: `${credits(CREDIT_COSTS.qgent_apply)}, vrácení zdarma` },
    { label: 'Reklamní fotka v Qads', value: credits(QADS.imagePerVariant) },
    { label: 'Reklamní video v Qads', value: `${kredity(videoExample)} za 5 s` },
    { label: 'Příprava reklam v Qads', value: `${kredity(QADS.strategyPerGeneration)} za generování` },
    { label: 'Stažení kódu jako ZIP', value: credits(CREDIT_COSTS.export) },
  ],
  hosting: { annualUsd: HOSTING_ANNUAL_USD, trialDays: 30 },
  agency: { monthlyUsd: AGENCY_MONTHLY_USD, projects: 20 },
}

/** The cost rows that belong on a module page. */
export function moduleCosts(slug: ModuleSlug): { label: string; value: string }[] {
  switch (slug) {
    case 'generate':
      return [
        { label: 'Vygenerování e-shopu', value: credits(CREDIT_COSTS.generate) },
        { label: 'Úprava v chatu', value: credits(CREDIT_COSTS.iterate) },
        { label: 'Automatické opravy buildu', value: credits(CREDIT_COSTS.fix) },
        { label: 'Stažení kódu jako ZIP', value: credits(CREDIT_COSTS.export) },
        { label: 'Hosting', value: `${HOSTING_ANNUAL_USD} USD ročně, první měsíc zdarma` },
      ]
    case 'qdit':
      return [
        { label: 'Ruční úpravy', value: free },
        { label: 'AI akce na prvku', value: `${credits(CREDIT_COSTS.iterate)}, při chybě se vrací` },
      ]
    case 'qgent':
      return [
        { label: 'Kontrola celého obchodu', value: `${credits(CREDIT_COSTS.qgent_review)}, při chybě se vrací` },
        { label: 'Provedení potvrzené změny', value: `${credits(CREDIT_COSTS.qgent_apply)}, při chybě se vrací` },
        { label: 'Zamítnutí a vrácení změny', value: free },
      ]
    case 'qads':
      return [
        { label: 'Fotka', value: `${kredity(QADS.imagePerVariant)} za kus` },
        { label: 'Video', value: `${QADS.videoPerSecond.toString().replace('.', ',')} kreditu za sekundu, zaokrouhleno nahoru (5 s = ${kredity(videoExample)})` },
        { label: 'Příprava reklam a textů', value: `${kredity(QADS.strategyPerGeneration)} za generování` },
      ]
    default:
      return []
  }
}
