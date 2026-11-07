// Quante prices for the website, read from the code that charges them — never typed in by hand:
// lib/credit-packs.ts (what Stripe sells), lib/config.ts (what each action debits, hosting,
// Agency) and lib/qads/pricing.ts (Qads). Prices are USD, as Stripe charges them.

import { AGENCY_BATCH_SIZE, AGENCY_FAIR_USE, AGENCY_MONTHLY_USD, CREDIT_COSTS, HOSTING_ANNUAL_USD, HOSTING_MONTHLY_USD, QSCAN_DAILY_SCANS } from '@/lib/config'
import { CREDIT_PACKS } from '@/lib/credit-packs'
import { QADS_GENERATOR_CREDIT_COSTS as QADS, TIKTOKER_LAUNCH, characterCredits, computeTiktokerCost } from '@/lib/qads/pricing'
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
const videoLongest = Math.ceil(QADS.videoPerSecond * 30)

// Qads Tiktoker: launch price (at cost) until TIKTOKER_LAUNCH.endsAt, then the regular one. Both
// are written out with fixed dates, so this copy (and Qgent's knowledge built from it) never
// changes by itself — the app charges whichever applies on the day (lib/qads/pricing.ts).
function tiktokerRows() {
  const during = new Date(TIKTOKER_LAUNCH.startsAt)
  const after = new Date(TIKTOKER_LAUNCH.endsAt)
  const last = new Date(Date.parse(TIKTOKER_LAUNCH.endsAt) - 1)
  const until = `${last.getUTCDate()}. ${last.getUTCMonth() + 1}. ${last.getUTCFullYear()}`
  const video = (at: Date) => `${kredity(computeTiktokerCost(1, 15, at).totalCredits)} za 15 s, ${kredity(computeTiktokerCost(1, 10, at).totalCredits)} za 10 s`
  return [
    { label: 'AI postava pro Qads Character', value: kredity(characterCredits(during)) },
    { label: 'Video s mluvící AI postavou', value: `do ${until} bez marže: ${video(during)}; potom ${video(after)}` },
  ]
}

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
    { label: 'Kontrola e-shopu 20 agenty v Qgent', value: credits(CREDIT_COSTS.qgent_swarm) },
    { label: 'Kontrola obchodu v Qgent ve Studiu', value: credits(CREDIT_COSTS.qgent_review) },
    { label: 'Změna od Qgent', value: `${credits(CREDIT_COSTS.qgent_apply)}, vrácení zdarma` },
    { label: 'Reklamní fotka v Qads', value: credits(QADS.imagePerVariant) },
    { label: 'Reklamní video v Qads', value: `${kredity(videoExample)} za 5 s` },
    { label: 'Příprava reklam v Qads', value: `${kredity(QADS.strategyPerGeneration)} za generování` },
    ...tiktokerRows(),
    { label: 'Stažení kódu jako ZIP', value: `${credits(CREDIT_COSTS.export)} za obchod, další stažení zdarma` },
  ],
  hosting: { annualUsd: HOSTING_ANNUAL_USD, trialDays: 30 },
  // What Agency includes (lib/agency-plan.ts is the app's list; the numbers come from lib/config.ts).
  agency: {
    monthlyUsd: AGENCY_MONTHLY_USD,
    summary: `neomezeně obchodů · hromadné generování až ${AGENCY_BATCH_SIZE} obchodů · generování, úpravy a Qads bez kreditů (fair use) · export bez značky Quante · hosting v ceně`,
    fairUse: `${AGENCY_FAIR_USE.generationsPerDay} generování obchodu, ${AGENCY_FAIR_USE.qadsVideoSecondsPerDay} sekund videa a ${AGENCY_FAIR_USE.qadsPhotosPerDay} fotek v Qads denně`,
    bulkExport: AGENCY_BATCH_SIZE,
  },
}

/** The cost rows that belong on a module page. */
export function moduleCosts(slug: ModuleSlug): { label: string; value: string }[] {
  switch (slug) {
    case 'generate':
      return [
        { label: 'Vygenerování e-shopu', value: credits(CREDIT_COSTS.generate) },
        { label: 'Úprava v chatu', value: credits(CREDIT_COSTS.iterate) },
        { label: 'Automatické opravy buildu', value: credits(CREDIT_COSTS.fix) },
        { label: 'Stažení kódu jako ZIP', value: `${credits(CREDIT_COSTS.export)} za obchod, další stažení zdarma` },
        { label: 'Hosting', value: `${HOSTING_ANNUAL_USD} USD ročně, první měsíc zdarma` },
      ]
    case 'qscan':
      return [
        { label: 'Sken obchodu', value: `${free}, až ${QSCAN_DAILY_SCANS} skenů denně` },
        { label: 'Postavení nového obchodu', value: credits(CREDIT_COSTS.generate) },
        { label: 'Hosting', value: `${String(HOSTING_MONTHLY_USD).replace('.', ',')} USD měsíčně, nebo ${HOSTING_ANNUAL_USD} USD ročně` },
        { label: 'Stažení kódu jako ZIP', value: `${credits(CREDIT_COSTS.export)} za obchod, další stažení zdarma` },
      ]
    case 'qdit':
      return [
        { label: 'Ruční úpravy', value: free },
        { label: 'AI akce na prvku', value: `${credits(CREDIT_COSTS.iterate)}, při chybě se vrací` },
      ]
    case 'qgent':
      return [
        { label: 'Kontrola e-shopu 20 agenty', value: `${credits(CREDIT_COSTS.qgent_swarm)}, při chybě se vrací` },
        { label: 'Nový e-shop podle starého', value: credits(CREDIT_COSTS.generate) },
        { label: 'Kontrola kódu obchodu ve Studiu', value: `${credits(CREDIT_COSTS.qgent_review)}, při chybě se vrací` },
        { label: 'Provedení potvrzené změny', value: `${credits(CREDIT_COSTS.qgent_apply)}, při chybě se vrací` },
        { label: 'Zamítnutí a vrácení změny', value: free },
      ]
    case 'qads':
      return [
        { label: 'Fotka', value: `${kredity(QADS.imagePerVariant)} za kus` },
        { label: 'Video (1080p, 4–30 s)', value: Number.isInteger(QADS.videoPerSecond)
          ? `${kredity(QADS.videoPerSecond)} za sekundu (5 s = ${kredity(videoExample)}, 30 s = ${kredity(videoLongest)})`
          : `${QADS.videoPerSecond.toString().replace('.', ',')} kreditu za sekundu, zaokrouhleno nahoru (5 s = ${kredity(videoExample)}, 30 s = ${kredity(videoLongest)})` },
        { label: 'Příprava reklam a textů', value: `${kredity(QADS.strategyPerGeneration)} za generování` },
        ...tiktokerRows(),
      ]
    default:
      return []
  }
}

// ── English (quantecode.com/en, owner 2026-11-07) ────────────────────────────────────────────────
// The same numbers from the same config, in English words. Keep the rows in step with the Czech ones.

/** 1 credit · 10 credits */
export const creditsEn = (n: number) => (n === 1 ? '1 credit' : `${n} credits`)
/** 999 → "9.99" */
export const usdEn = (cents: number) => usd(cents).replace(',', '.')

const freeEn = 'free'
const cEn = (n: number) => (n === 0 ? freeEn : creditsEn(n))

function tiktokerRowsEn() {
  const during = new Date(TIKTOKER_LAUNCH.startsAt)
  const after = new Date(TIKTOKER_LAUNCH.endsAt)
  const last = new Date(Date.parse(TIKTOKER_LAUNCH.endsAt) - 1)
  const until = last.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const video = (at: Date) => `${creditsEn(computeTiktokerCost(1, 15, at).totalCredits)} for 15 s, ${creditsEn(computeTiktokerCost(1, 10, at).totalCredits)} for 10 s`
  return [
    { label: 'AI character for Qads Character', value: creditsEn(characterCredits(during)) },
    { label: 'Video with a talking AI character', value: `until ${until} at cost: ${video(during)}; then ${video(after)}` },
  ]
}

export const quantePricingEn = {
  packs: CREDIT_PACKS.map((p) => ({
    id: p.id,
    credits: p.credits,
    price: usdEn(p.priceCents),
    perCredit: usdEn(Math.round(p.priceCents / p.credits)),
    popular: !!p.popular,
  })),
  welcomeCredits: CREDIT_COSTS.welcome_grant,
  costs: [
    { label: 'Generating a store', value: cEn(CREDIT_COSTS.generate) },
    { label: 'A change in the chat', value: cEn(CREDIT_COSTS.iterate) },
    { label: 'Automatic build fixes', value: cEn(CREDIT_COSTS.fix) },
    { label: 'Editing by hand in Qdit', value: freeEn },
    { label: 'AI in Qdit', value: cEn(CREDIT_COSTS.iterate) },
    { label: 'Store review by 20 agents in Qgent', value: cEn(CREDIT_COSTS.qgent_swarm) },
    { label: 'Store review by Qgent in the Studio', value: cEn(CREDIT_COSTS.qgent_review) },
    { label: 'A change made by Qgent', value: `${cEn(CREDIT_COSTS.qgent_apply)}, undo free` },
    { label: 'Ad photo in Qads', value: cEn(QADS.imagePerVariant) },
    { label: 'Ad video in Qads', value: `${creditsEn(videoExample)} for 5 s` },
    { label: 'Ad preparation in Qads', value: `${creditsEn(QADS.strategyPerGeneration)} per generation` },
    ...tiktokerRowsEn(),
    { label: 'Code download as a ZIP', value: `${cEn(CREDIT_COSTS.export)} per store, later downloads free` },
  ],
  hosting: { annualUsd: HOSTING_ANNUAL_USD, trialDays: 30 },
  agency: {
    monthlyUsd: AGENCY_MONTHLY_USD,
    summary: `unlimited stores · batch generation of up to ${AGENCY_BATCH_SIZE} stores · generation, edits and Qads without credits (fair use) · export without Quante branding · hosting included`,
    fairUse: `${AGENCY_FAIR_USE.generationsPerDay} store generations, ${AGENCY_FAIR_USE.qadsVideoSecondsPerDay} seconds of video and ${AGENCY_FAIR_USE.qadsPhotosPerDay} photos in Qads a day`,
  },
}

/** The cost rows of an English module page (same rows as moduleCosts). */
export function moduleCostsEn(slug: ModuleSlug): { label: string; value: string }[] {
  switch (slug) {
    case 'generate':
      return [
        { label: 'Generating a store', value: cEn(CREDIT_COSTS.generate) },
        { label: 'A change in the chat', value: cEn(CREDIT_COSTS.iterate) },
        { label: 'Automatic build fixes', value: cEn(CREDIT_COSTS.fix) },
        { label: 'Code download as a ZIP', value: `${cEn(CREDIT_COSTS.export)} per store, later downloads free` },
        { label: 'Hosting', value: `${HOSTING_ANNUAL_USD} USD a year, first month free` },
      ]
    case 'qscan':
      return [
        { label: 'Scanning a store', value: `${freeEn}, up to ${QSCAN_DAILY_SCANS} scans a day` },
        { label: 'Building the new store', value: cEn(CREDIT_COSTS.generate) },
        { label: 'Hosting', value: `${HOSTING_MONTHLY_USD} USD a month or ${HOSTING_ANNUAL_USD} USD a year` },
        { label: 'Code download as a ZIP', value: `${cEn(CREDIT_COSTS.export)} per store, later downloads free` },
      ]
    case 'qdit':
      return [
        { label: 'Editing by hand', value: freeEn },
        { label: 'AI action on an element', value: `${cEn(CREDIT_COSTS.iterate)}, refunded on failure` },
      ]
    case 'qgent':
      return [
        { label: 'Store review by 20 agents', value: `${cEn(CREDIT_COSTS.qgent_swarm)}, refunded on failure` },
        { label: 'A new store from the old one', value: cEn(CREDIT_COSTS.generate) },
        { label: 'Code review of a store in the Studio', value: `${cEn(CREDIT_COSTS.qgent_review)}, refunded on failure` },
        { label: 'Making a confirmed change', value: `${cEn(CREDIT_COSTS.qgent_apply)}, refunded on failure` },
        { label: 'Rejecting or undoing a change', value: freeEn },
      ]
    case 'qads':
      return [
        { label: 'Photo', value: `${creditsEn(QADS.imagePerVariant)} each` },
        { label: 'Video (1080p, 4–30 s)', value: Number.isInteger(QADS.videoPerSecond)
          ? `${creditsEn(QADS.videoPerSecond)} a second (5 s = ${creditsEn(videoExample)}, 30 s = ${creditsEn(videoLongest)})`
          : `${QADS.videoPerSecond} credits a second, rounded up (5 s = ${creditsEn(videoExample)}, 30 s = ${creditsEn(videoLongest)})` },
        { label: 'Preparing ads and copy', value: `${creditsEn(QADS.strategyPerGeneration)} per generation` },
        ...tiktokerRowsEn(),
      ]
    default:
      return []
  }
}
