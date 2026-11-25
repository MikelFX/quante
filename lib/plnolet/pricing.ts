// Plnolet plans — the ONE place their prices live (design doc, owner chose "Postavit vlastní
// Plnolet" 2026-11-25). Proposed prices, CZK without VAT; nothing is charged yet: paid plans start
// only after the operator's trade licence (CLAUDE.md §13d). Client-safe, no imports.

export interface PlnoletPlan {
  id: 'brana' | 'start' | 'obchod' | 'pro'
  name: string
  monthlyCzk: number
  /** New identity checks included each month (returning shoppers with an age pass are free). */
  included: number | null
  extraCzk: number | null
  forWhom: string
}

export const PLNOLET_PLANS: readonly PlnoletPlan[] = [
  { id: 'brana', name: 'Brána', monthlyCzk: 0, included: null, extraCzk: null, forWhom: 'Okno „Je mi 18“ na vstupu webu, bez ověření totožnosti' },
  { id: 'start', name: 'Start', monthlyCzk: 249, included: 100, extraCzk: 2.5, forWhom: 'Malý e-shop' },
  { id: 'obchod', name: 'Obchod', monthlyCzk: 690, included: 400, extraCzk: 2, forWhom: 'Běžný vape nebo tabákový e-shop' },
  { id: 'pro', name: 'Pro', monthlyCzk: 1990, included: 1500, extraCzk: 1.5, forWhom: 'Větší e-shopy, více domén' },
]

export const PLNOLET_PAID = false as boolean // flips when billing exists (after the trade licence)

export const czk = (n: number) =>
  new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(n) + ' Kč'
