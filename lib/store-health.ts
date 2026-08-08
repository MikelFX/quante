// Store Health Score — gamified "Ready to sell" checklist for the Studio.
// Pure, side-effect-free scoring logic. Source of truth for the checklist items is
// quante-cz-launch-spec.md §9 ("Admin checklist 'Připraveno k prodeji'"), adapted here
// as an informational score rather than a hard publish-blocker — the spec frames unmet
// items as blocking publication, but the actual feature request asked for a gamified
// display in the Studio, not an enforcement gate. Revisit if that changes.
//
// Consumed by app/api/projects/[id]/health/route.ts. Kept dependency-free (no supabase
// client, no Next.js imports) so it can be unit-tested in isolation — see
// __tests__/store-health.test.mjs.

import type { ShopManifest } from '@/types/manifest'
import type { StoreProduct } from '@/types/store-code'

export type HealthActionTarget = 'legal' | 'settings' | 'products' | 'theme' | 'publish'

export interface HealthCheckItem {
  id: string
  label: string
  done: boolean
  detail: string
  actionLabel?: string
  actionTarget?: HealthActionTarget
}

export interface StoreHealthResult {
  score: number // 0-100
  doneCount: number
  totalCount: number
  readyToSell: boolean
  items: HealthCheckItem[]
  live: { isLive: boolean; url: string | null; hasCustomDomain: boolean }
}

export interface StoreHealthInput {
  manifest: ShopManifest | null
  products: StoreProduct[] | null
  hasCookieConsent: boolean
  deployment: {
    status: string | null
    domain: string | null
    customDomain: string | null
    customDomainVerified: boolean
  } | null
  emailTestSentAt: string | null
}

// Loose IČO check — 8 digits. (Full mod-11 checksum validation is deliberately not
// enforced here: some legitimate edge-case IČOs and all foreign VAT-equivalent ids would
// otherwise be flagged as invalid. Matches the spec's "IČO validní" at a practical level.)
function isValidIco(ico: string | undefined): boolean {
  return !!ico && /^\d{8}$/.test(ico.trim())
}

const LEGAL_SLUGS = ['obchodni-podminky', 'ochrana-osobnich-udaju', 'cookies', 'kontakt']

export function computeStoreHealth(input: StoreHealthInput): StoreHealthResult {
  const { manifest, products, hasCookieConsent, deployment, emailTestSentAt } = input
  const m = manifest?.merchant

  // 1. Merchant data
  const merchantComplete = !!(
    m &&
    m.obchodni_nazev?.trim() &&
    isValidIco(m.ico) &&
    m.sidlo?.ulice?.trim() &&
    m.sidlo?.mesto?.trim() &&
    m.sidlo?.psc?.trim() &&
    m.kontakt?.email?.trim()
  )

  // 2. Legal pages (4 required, generated via /api/quante/legal)
  const customPageSlugs = new Set((manifest?.customPages ?? []).map((p) => p.slug))
  const legalPagesDone = LEGAL_SLUGS.every((slug) => customPageSlugs.has(slug))
  const legalPagesPresent = LEGAL_SLUGS.filter((slug) => customPageSlugs.has(slug)).length

  // 3. Payment method active
  const payments = manifest?.payments
  const paymentActive = !!(
    payments &&
    ((payments.providers?.length ?? 0) > 0 ||
      payments.dobirka?.enabled ||
      payments.prevod?.enabled)
  )

  // 4. Shipping method with price
  const shippingMethods = manifest?.shipping?.methods ?? []
  const shippingDone = shippingMethods.length > 0 && shippingMethods.every((sm) => typeof sm.cena_czk === 'number' && sm.cena_czk >= 0)

  // 5. Transactional email tested
  const emailTested = !!emailTestSentAt

  // 6. At least one product with photo, price and availability
  const productList = products ?? manifest?.catalog.products ?? []
  const sellableProduct = productList.find(
    (p) => p.images?.length > 0 && typeof p.price === 'number' && p.price > 0 && p.available
  )

  // 7. Cookie consent bar present in the deployed code
  const cookieBarDone = hasCookieConsent

  // Bonus signal (not a separate scored item, surfaced via deployment item's detail):
  const isLive = deployment?.status === 'ready'
  const hasCustomDomain = !!deployment?.customDomain && deployment.customDomainVerified

  const items: HealthCheckItem[] = [
    {
      id: 'merchant',
      label: 'Fakturační údaje',
      done: merchantComplete,
      detail: merchantComplete
        ? `${m!.obchodni_nazev} · IČO ${m!.ico}`
        : 'Doplňte název firmy, IČO a sídlo v nastavení obchodu.',
      actionLabel: 'Doplnit údaje',
      actionTarget: 'settings',
    },
    {
      id: 'legal_pages',
      label: 'Právní stránky (4×)',
      done: legalPagesDone,
      detail: legalPagesDone
        ? 'Obchodní podmínky, GDPR, cookies a kontakt vygenerovány.'
        : `${legalPagesPresent}/4 stránek hotovo — vygenerujte zbývající v chatu ("Vytvoř právní stránky").`,
      actionLabel: 'Vygenerovat stránky',
      actionTarget: 'legal',
    },
    {
      id: 'payment',
      label: 'Platební metoda',
      done: paymentActive,
      detail: paymentActive
        ? 'Alespoň jedna platební metoda je aktivní.'
        : 'Zapněte platbu převodem, dobírkou nebo platební bránu v nastavení.',
      actionLabel: 'Nastavit platby',
      actionTarget: 'settings',
    },
    {
      id: 'shipping',
      label: 'Doprava s cenou',
      done: shippingDone,
      detail: shippingDone
        ? `${shippingMethods.length} dopravní metod${shippingMethods.length === 1 ? 'a' : 'y'} nastaveno.`
        : 'Přidejte alespoň jednu dopravní metodu s cenou.',
      actionLabel: 'Nastavit dopravu',
      actionTarget: 'settings',
    },
    {
      id: 'email_test',
      label: 'Test transakčního e-mailu',
      done: emailTested,
      detail: emailTested
        ? `Testovací e-mail odeslán ${new Date(emailTestSentAt as string).toLocaleDateString('cs-CZ')}.`
        : 'Odešlete testovací potvrzení objednávky na svou adresu.',
      actionLabel: 'Odeslat test',
      actionTarget: 'settings',
    },
    {
      id: 'product',
      label: 'Produkt s fotkou a cenou',
      done: !!sellableProduct,
      detail: sellableProduct
        ? `"${sellableProduct.name}" je připraven k prodeji.`
        : 'Přidejte alespoň jeden produkt s fotkou, cenou a skladem.',
      actionLabel: 'Přidat produkt',
      actionTarget: 'products',
    },
    {
      id: 'cookie_bar',
      label: 'Cookie lišta',
      done: cookieBarDone,
      detail: cookieBarDone
        ? 'Cookie lišta je součástí obchodu.'
        : 'Cookie lišta chybí — vygenerujte obchod znovu.',
      actionLabel: 'Otevřít Builder',
      actionTarget: 'theme',
    },
  ]

  const doneCount = items.filter((i) => i.done).length
  const totalCount = items.length
  const score = Math.round((doneCount / totalCount) * 100)

  return {
    score,
    doneCount,
    totalCount,
    readyToSell: doneCount === totalCount,
    items,
    // Live/domain status isn't scored (publishing is a deliberate action, not a
    // readiness checklist item) but is useful context for the UI to show alongside.
    live: {
      isLive,
      url: deployment?.customDomain && deployment.customDomainVerified
        ? deployment.customDomain
        : deployment?.domain ?? null,
      hasCustomDomain,
    },
  }
}
