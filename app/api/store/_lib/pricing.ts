// Server-side catalog / shipping / fee resolution for the public store checkout.
// Server-only. `_lib` is a private folder, so nothing in here is routed.
//
// SECURITY (audit #3 / #8): the checkout must NEVER take a price, item name, shipping
// cost, COD fee or currency from the request body — anyone can POST any numbers. This
// module loads the merchant's own data:
//   - code-gen stores: products from data/products.ts and currency from data/config.ts
//     of the code version that is actually LIVE (the latest ready production
//     deployment — preview / iteration deploys share the deployments table and must not
//     reprice the live store), falling back to the latest code version only for product
//     ids the live catalog doesn't know; shipping from project_secrets.shipping_json,
//     COD / bank transfer from project_secrets.payments_json (the same sources
//     /api/store/shipping and the Publish panel use);
//   - legacy manifest stores: manifest.catalog / manifest.shipping / manifest.payments
//     from the latest manifest_versions row.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseProductsForPricing, PRODUCTS_FILE, type PricingProduct } from '@/lib/store-products'
import { parseConfigFile, CONFIG_FILE } from '@/lib/store-config'
import type { ShopManifest } from '@/types/manifest'
import type { PaymentsInfo, ShippingInfo } from '@/types/business'
import { productionRowsNewestFirst } from '@/lib/hosting/scaffold-rollout-rules'
import { isUnknownColumnError } from '@/lib/hosting/deployments'

export interface PricedLine {
  productId: string
  variantId?: string
  name: string
  unitCents: number
}

export interface ShippingOption {
  id: string
  label: string
  cents: number
}

export interface StorePricing {
  mode: 'code' | 'manifest'
  currency: string // upper-case ISO 4217, always in SUPPORTED_CURRENCIES
  /** Server-side price for a cart line; null for unknown / unavailable products or variants. */
  price(productId: string, variantId?: string): PricedLine | null
  shippingMethods: ShippingOption[]
  freeShippingFromCents: number
  cod: { enabled: boolean; feeCents: number }
  bankTransferEnabled: boolean
  /** Online payment methods the merchant offers (stripe / comgate / gopay / paypal). */
  onlineMethods: ReadonlySet<string>
}

const GATEWAY_METHODS = ['comgate', 'gopay', 'paypal'] as const

// Hard ceiling on a single unit price (major units) — anything above is treated as a
// broken catalog entry rather than charged.
const MAX_UNIT_PRICE = 10_000_000

// SECURITY (audit #8): only two-decimal currencies Quante actually supports. The
// merchant controls data/config.ts / the manifest, so an arbitrary ISO code (e.g. a
// zero-decimal JPY/IDR, which toCents() would also charge 100x) is refused instead of
// being sent to Stripe / the gateways.
export const SUPPORTED_CURRENCIES = new Set([
  'CZK', 'EUR', 'USD', 'GBP', 'PLN', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'NZD', 'RON',
])

export function toCents(major: unknown): number | null {
  const n = Number(major)
  if (!Number.isFinite(n) || n < 0 || n > MAX_UNIT_PRICE) return null
  return Math.round(n * 100)
}

const LEGACY_SHIPPING_LABELS: Record<string, string> = {
  zasilkovna: 'Zásilkovna',
  packeta_international: 'Packeta International',
  dhl: 'DHL Express',
  ppl: 'PPL',
  dpd: 'DPD',
  balikovna: 'Balíkovna',
  osobni_odber: 'Osobní odběr',
  custom: 'Doručení',
}

function normCurrency(c: unknown): string | null {
  return typeof c === 'string' && /^[A-Za-z]{3}$/.test(c.trim()) ? c.trim().toUpperCase() : null
}

interface CodeCatalog { files: Record<string, string>; live: boolean }

type LiveCandidateRow = {
  code_version_id: string | null; domain: string | null; url: string | null; target?: string | null
  created_at: string | null; promoted_at?: string | null
}

async function loadReadyDeployments(projectId: string): Promise<LiveCandidateRow[]> {
  const query = (columns: string, productionOnly: boolean) => {
    let q = supabaseAdmin
      .from('deployments')
      .select(columns)
      .eq('project_id', projectId)
      .eq('status', 'ready')
      .not('code_version_id', 'is', null)
    // Draft ('staged') and preview builds can never be live — excluding them keeps a run
    // of unpublished chat edits from pushing the live build out of the window below.
    if (productionOnly) q = q.or('target.is.null,target.eq.production')
    return q.order('created_at', { ascending: false }).limit(50)
  }
  const withPromotion = await query('code_version_id, domain, url, target, created_at, promoted_at', true)
  if (!withPromotion.error) return (withPromotion.data ?? []) as unknown as LiveCandidateRow[]
  if (!isUnknownColumnError(withPromotion.error)) return []
  // Before migration-draft-publish.sql: no promoted_at (nothing was ever promoted).
  const first = await query('code_version_id, domain, url, target, created_at', true)
  // Before migration-scaffold-version.sql there is no `target` column — legacy rules only.
  if (first.error && isUnknownColumnError(first.error)) {
    const legacy = await query('code_version_id, domain, url, created_at', false)
    return (legacy.data ?? []) as unknown as LiveCandidateRow[]
  }
  return (first.data ?? []) as unknown as LiveCandidateRow[]
}

async function loadCodeVersionFiles(projectId: string): Promise<CodeCatalog[]> {
  const out: CodeCatalog[] = []
  const seen = new Set<string>()

  // The version that is live: the most recent ready PRODUCTION deployment — the same
  // classifier the scaffold rollout uses (lib/hosting/scaffold-rollout-rules.ts): the
  // row's `target` when recorded, else domain recorded or a public (non-*.vercel.app)
  // URL. Legacy rows of unknown target count as previews here.
  // A promoted draft build counts from when it was promoted (liveSinceMs), not created.
  const live = productionRowsNewestFirst(
    (await loadReadyDeployments(projectId)).map((d) => ({ id: '', status: 'ready', ...d })),
  )[0]
  const deployedId = live?.code_version_id ?? null
  if (deployedId) {
    const { data: v } = await supabaseAdmin
      .from('code_versions')
      .select('id, files')
      .eq('id', deployedId)
      .eq('project_id', projectId) // never read another tenant's catalog
      .maybeSingle()
    if (v?.files) { out.push({ files: v.files as Record<string, string>, live: true }); seen.add(v.id as string) }
  }

  // Latest version as a fallback — only for product ids the live catalog doesn't
  // have (see priceFromProducts: the live catalog always wins when it knows the id).
  const { data: latest } = await supabaseAdmin
    .from('code_versions')
    .select('id, files')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest?.files && !seen.has(latest.id as string)) out.push({ files: latest.files as Record<string, string>, live: false })
  return out
}

function priceFromProducts(catalogs: PricingProduct[][], opts: { requireVariant: boolean }) {
  return (productId: string, variantId?: string): PricedLine | null => {
    // Catalogs are ordered live-first: the first catalog that knows the id decides
    // (a product removed / repriced only in an unpublished version is unaffected).
    for (const products of catalogs) {
      const p = products.find((x) => x.id === productId)
      if (!p) continue
      if (p.available === false) return null
      let unit = toCents(p.price)
      let name = p.name
      const variants = p.variants ?? []
      if (variantId) {
        const v = variants.find((x) => x.id === variantId)
        if (!v) return null
        if (v.price !== undefined && v.price !== null) unit = toCents(v.price)
        name = `${p.name} (${v.name})`
      } else if (opts.requireVariant && variants.length > 0) {
        // Legacy manifest storefronts make the shopper pick a variant, and a variant
        // may override the price — a variant-less line would buy it at the base price.
        return null
      }
      // Code-gen carts have no variant picker, so there a variant-less line is the
      // merchant's base price (what the product page displays).
      if (unit === null) return null
      return { productId: p.id, variantId, name: String(name).slice(0, 200), unitCents: unit }
    }
    return null
  }
}

function currencyFromConfig(content: string): string | null {
  const cfg = parseConfigFile(content)
  return normCurrency(cfg?.brand.currency)
    ?? normCurrency(content.match(/currency\s*:\s*['"]([A-Za-z]{3})['"]/)?.[1])
}

/** Resolves the authoritative pricing data for a project, or null when none is configured. */
export async function loadStorePricing(projectId: string): Promise<StorePricing | null> {
  const codeFiles = await loadCodeVersionFiles(projectId)

  if (codeFiles.length > 0) {
    const catalogs: PricingProduct[][] = []
    let currency: string | null = null
    for (const { files } of codeFiles) {
      // Tolerant parse: one odd product must not take the whole store's checkout down.
      const products = typeof files[PRODUCTS_FILE] === 'string' ? parseProductsForPricing(files[PRODUCTS_FILE]) : null
      if (products && products.length > 0) catalogs.push(products)
      // Currency from the live version first (codeFiles is ordered live-first).
      if (!currency && typeof files[CONFIG_FILE] === 'string') currency = currencyFromConfig(files[CONFIG_FILE])
    }
    if (catalogs.length === 0 || !currency) {
      console.error('[store/pricing] code-gen store has no parseable catalog or currency — checkout disabled', {
        projectId, catalogs: catalogs.length, currency, versions: codeFiles.length, liveVersion: codeFiles.some((c) => c.live),
      })
      return null
    }
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      console.error('[store/pricing] unsupported store currency — checkout disabled', { projectId, currency })
      return null
    }

    const { data: secrets } = await supabaseAdmin
      .from('project_secrets')
      .select('shipping_json, payments_json')
      .eq('project_id', projectId)
      .maybeSingle()
    const shipping = (secrets?.shipping_json as Partial<ShippingInfo> | null) ?? null
    const payments = (secrets?.payments_json as Partial<PaymentsInfo> | null) ?? null

    const configured = Array.isArray(shipping?.methods) ? shipping!.methods : []
    const shippingMethods: ShippingOption[] = configured.length
      ? configured
          .map((m) => ({ id: String(m?.id ?? ''), label: String(m?.label ?? '').slice(0, 200), cents: toCents(m?.price) }))
          .filter((m): m is ShippingOption => !!m.id && m.cents !== null)
      // Same generic fallback /api/store/shipping serves when nothing is configured.
      : [{ id: 'standard', label: 'Standard shipping', cents: 0 }]

    return {
      mode: 'code',
      currency,
      price: priceFromProducts(catalogs, { requireVariant: false }),
      shippingMethods,
      freeShippingFromCents: toCents(shipping?.freeShippingFrom) ?? 0,
      cod: { enabled: payments?.cod?.enabled === true, feeCents: toCents(payments?.cod?.fee) ?? 0 },
      // Unpaid orders send email immediately, so they need an explicit opt-in: the
      // code-gen storefront has no payment picker, and a store that never saved
      // payment settings (payments_json null) must not accept bank-transfer orders.
      bankTransferEnabled: payments?.bankTransfer?.enabled === true,
      // Card payment through the platform's Stripe is the code-gen storefront's
      // default (there is no merchant toggle for it), and so is PayPal once the
      // merchant saved PayPal credentials (no toggle either). Comgate / GoPay only when
      // enabled in the Merchant panel (payments_json.providers). Every gateway also
      // needs the merchant's own credentials (lib/payments/project-providers.ts).
      onlineMethods: new Set<string>([
        'stripe',
        'paypal',
        ...(Array.isArray(payments?.providers)
          ? (payments!.providers as unknown[]).filter((p): p is string => typeof p === 'string' && (GATEWAY_METHODS as readonly string[]).includes(p))
          : []),
      ]),
    }
  }

  const { data: versionRow } = await supabaseAdmin
    .from('manifest_versions')
    .select('manifest')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  const manifest = versionRow?.manifest as ShopManifest | undefined
  if (!manifest?.catalog?.products) {
    console.error('[store/pricing] no code version and no manifest catalog — checkout disabled', { projectId })
    return null
  }
  const currency = normCurrency(manifest.catalog.currency)
  if (!currency || !SUPPORTED_CURRENCIES.has(currency)) {
    console.error('[store/pricing] manifest store has a missing/unsupported currency — checkout disabled', { projectId, currency })
    return null
  }

  const shippingMethods: ShippingOption[] = (manifest.shipping?.methods ?? [])
    .map((m) => ({ id: String(m.type), label: String(m.nazev ?? LEGACY_SHIPPING_LABELS[m.type] ?? m.type).slice(0, 200), cents: toCents(m.cena_czk) }))
    .filter((m): m is ShippingOption => !!m.id && m.cents !== null)

  // Mirrors allowedPaymentMethods() of the deployed legacy template
  // (lib/store-template/build.ts): bank transfer only when enabled explicitly, or as
  // the fallback when the store offers no provider and no COD.
  const providers = Array.isArray(manifest.payments?.providers) ? manifest.payments!.providers : []
  const codEnabled = manifest.payments?.dobirka?.enabled === true
  const bankTransferEnabled = manifest.payments?.prevod?.enabled === true || (providers.length === 0 && !codEnabled)

  return {
    mode: 'manifest',
    currency,
    price: priceFromProducts(
      [manifest.catalog.products.map((p) => ({ id: p.id, name: p.name, price: p.price, available: p.available, variants: p.variants }))],
      { requireVariant: true },
    ),
    shippingMethods,
    freeShippingFromCents: toCents(manifest.shipping?.doprava_zdarma_od_czk) ?? 0,
    cod: { enabled: codEnabled, feeCents: toCents(manifest.payments?.dobirka?.priplatek_czk) ?? 0 },
    bankTransferEnabled,
    // Only the providers the merchant listed. A manifest with no payments block at all
    // gets card payment (what components/storefront/CheckoutForm.tsx offers then).
    onlineMethods: new Set<string>(
      manifest.payments
        ? (providers as unknown[]).filter((p): p is string => typeof p === 'string' && (p === 'stripe' || (GATEWAY_METHODS as readonly string[]).includes(p)))
        : ['stripe'],
    ),
  }
}

/**
 * Read-only stock check against store_inventory (hosted stores). Lines without an
 * inventory row are untracked and always pass. Returns the first line that exceeds
 * the stock on hand, or null. Stock is not reserved here (an abandoned card checkout
 * must not lock it); the decrement belongs to payment capture.
 */
export async function findOutOfStock(
  projectId: string,
  lines: Array<{ id: string; variantId?: string; quantity: number }>,
): Promise<{ id: string; variantId?: string } | null> {
  const ids = [...new Set(lines.map((l) => l.id))]
  if (ids.length === 0) return null
  const { data, error } = await supabaseAdmin
    .from('store_inventory')
    .select('product_id, variant_id, stock_qty')
    .eq('project_id', projectId)
    .in('product_id', ids)
  // Table missing (migration not run) → inventory isn't tracked; don't block orders.
  if (error || !data) return null
  const stock = new Map<string, number>()
  for (const r of data as Array<{ product_id: string; variant_id: string | null; stock_qty: number }>) {
    stock.set(`${r.product_id}\u0000${r.variant_id ?? ''}`, Number(r.stock_qty))
  }
  for (const l of lines) {
    const qty = stock.get(`${l.id}\u0000${l.variantId ?? ''}`)
    if (qty !== undefined && Number.isFinite(qty) && l.quantity > qty) return { id: l.id, variantId: l.variantId }
  }
  return null
}
