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
//
// 2026-08-21: merchant/payments/shipping/legal-pages inputs switched from the legacy
// ShopManifest (manifest_versions — never populated for code-gen mode stores, so these
// checks could never pass) to project_secrets (merchant_json/payments_json/
// shipping_json) and code_versions file presence, matching how the data is actually
// stored/read now. See MerchantPanel.tsx and app/api/quante/legal/route.ts.

import type { BusinessInfo, PaymentsInfo, ShippingInfo } from '@/types/business'
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
  merchant: BusinessInfo | null
  payments: PaymentsInfo | null
  shipping: ShippingInfo | null
  legalPagesPresent: number // 0-4, how many of the 4 required legal page files exist in code_versions
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

// Loose company-id check — non-empty is enough for non-CZ markets; CZ gets the real
// 8-digit IČO check since ARES lookup is only offered there.
function isValidTaxId(merchant: BusinessInfo): boolean {
  if (!merchant.taxId?.trim()) return false
  if (merchant.country === 'CZ') return /^\d{8}$/.test(merchant.taxId.trim())
  return true
}

export function computeStoreHealth(input: StoreHealthInput): StoreHealthResult {
  const { merchant, payments, shipping, legalPagesPresent, products, hasCookieConsent, deployment, emailTestSentAt } = input

  // 1. Merchant data
  const merchantComplete = !!(
    merchant &&
    merchant.name?.trim() &&
    isValidTaxId(merchant) &&
    merchant.street?.trim() &&
    merchant.city?.trim() &&
    merchant.postalCode?.trim() &&
    merchant.email?.trim()
  )

  // 2. Legal pages (4 required, generated via /api/quante/legal — app/terms,
  // app/privacy, app/cookies, app/contact page files in code_versions)
  const legalPagesDone = legalPagesPresent >= 4

  // 3. Payment method active
  const paymentActive = !!(
    payments &&
    ((payments.providers?.length ?? 0) > 0 ||
      payments.cod?.enabled ||
      payments.bankTransfer?.enabled)
  )

  // 4. Shipping method with price
  const shippingMethods = shipping?.methods ?? []
  const shippingDone = shippingMethods.length > 0 && shippingMethods.every((sm) => typeof sm.price === 'number' && sm.price >= 0)

  // 5. Transactional email tested
  const emailTested = !!emailTestSentAt

  // 6. At least one product with photo, price and availability
  const productList = products ?? []
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
        ? `${merchant!.name} · ${merchant!.taxId}`
        : 'Doplňte název firmy, IČO/registrační číslo a sídlo v Publish panelu.',
      actionLabel: 'Doplnit údaje',
      actionTarget: 'publish',
    },
    {
      id: 'legal_pages',
      label: 'Právní stránky (4×)',
      done: legalPagesDone,
      detail: legalPagesDone
        ? 'Obchodní podmínky, zásady ochrany osobních údajů, cookies a kontakt vygenerovány.'
        : `${legalPagesPresent}/4 stránek hotovo — vygenerujte je v Publish panelu ("Generate legal pages").`,
      actionLabel: 'Vygenerovat stránky',
      actionTarget: 'legal',
    },
    {
      id: 'payment',
      label: 'Platební metoda',
      done: paymentActive,
      detail: paymentActive
        ? 'Alespoň jedna platební metoda je aktivní.'
        : 'Zapněte platbu převodem, dobírkou nebo platební bránu v Publish panelu.',
      actionLabel: 'Nastavit platby',
      actionTarget: 'publish',
    },
    {
      id: 'shipping',
      label: 'Doprava s cenou',
      done: shippingDone,
      detail: shippingDone
        ? `${shippingMethods.length} dopravní metod${shippingMethods.length === 1 ? 'a' : 'y'} nastaveno.`
        : 'Přidejte alespoň jednu dopravní metodu s cenou v Publish panelu.',
      actionLabel: 'Nastavit dopravu',
      actionTarget: 'publish',
    },
    {
      id: 'email_test',
      label: 'Test transakčního e-mailu',
      done: emailTested,
      detail: emailTested
        ? `Testovací e-mail odeslán ${new Date(emailTestSentAt as string).toLocaleDateString('cs-CZ')}.`
        : 'Odešlete testovací potvrzení objednávky na svou adresu.',
      actionLabel: 'Odeslat test',
      actionTarget: 'publish',
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
        : 'Cookie lišta chybí v tomto obchodě.',
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
