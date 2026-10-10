// What the Agency plan includes, as the app shows it (Billing, dashboard). Every line must be
// true in code: unlimited projects (lib/tier.ts activeProjectLimit), no credits for store work
// (generate route + lib/credits.ts debitUnlessAgency), Qads fair use (lib/qads/fair-use.ts),
// white-label bulk export (app/api/export/bulk), hosting (lib/hosting/gate.ts). A line that is
// not built yet carries `soon` and is shown as such. The website's Czech copy lives in
// content/assetra/quante-pricing.ts and reads the same numbers.
import { AGENCY_BATCH_SIZE, AGENCY_FAIR_USE } from './config'

const F = AGENCY_FAIR_USE

export const AGENCY_FEATURES: Array<{ text: string; soon?: boolean }> = [
  { text: 'Unlimited stores — no project limit' },
  { text: `Store generations without credits — fair use ${F.generationsPerDay} a day` },
  { text: 'Chat, editor and Qgent edits, image actions, insights and preview deploys without credits' },
  { text: `Qads included — fair use ${F.qadsVideosPerDay} videos and ${F.qadsPhotosPerDay} photos a day` },
  { text: `Bulk export of up to ${AGENCY_BATCH_SIZE} stores at once — white-label ZIP, no Quante branding` },
  { text: 'Production hosting for every store included' },
  { text: `Batch generation of up to ${AGENCY_BATCH_SIZE} stores at once`, soon: true },
]

export const AGENCY_SUMMARY =
  'Unlimited stores · generations, edits and Qads without credits (fair use) · white-label bulk export · hosting included'
