// Derives a frozen ShopAdBrandContext snapshot for a project — Qads's entire "no brand
// brief from the user" design (docs/qads-proposal.md §3.1). Everything here is read from
// data Quante already has: the project's latest generated code (data/config.ts +
// data/products.ts inside code_versions.files), and project_secrets business/market
// fields. No new brand-brief prompt is ever shown to the merchant.
//
// Called once per campaign at campaign-creation time; the result is stored on
// qads_campaigns.brand_context and every later pipeline node (strategy, angles, copy,
// image prompts) reads that frozen copy rather than re-deriving it — this is what keeps
// a multi-asset, multi-channel campaign reading as ONE campaign instead of drifting
// asset-to-asset.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseProductsFile, PRODUCTS_FILE } from '@/lib/store-products'
import { parseConfigFile, CONFIG_FILE } from '@/lib/store-config'
import type { CodeVersionFiles, StoreConfig } from '@/types/store-code'
import type { BusinessInfo } from '@/types/business'
import type { ShopAdBrandContext, ShopAdBrandProduct } from '../types'

const DEFAULT_CONFIG: Pick<StoreConfig, 'brand' | 'design'> = {
  brand: { name: 'Store', tagline: '', currency: 'usd', language: 'en', country: 'US' },
  design: {
    colors: { bg: '#ffffff', text: '#111111', accent: '#3b82f6', accentText: '#ffffff', muted: '#6b7280', surface: '#f9fafb', border: '#e5e7eb' },
    fonts: { heading: 'Inter', body: 'Inter' },
    radius: '8px',
  },
}

export interface DeriveBrandContextParams {
  projectId: string
  /** Restrict to these store_inventory.product_id values (qads_campaigns.product_ids); all products when omitted. */
  productIds?: string[]
}

export interface DeriveBrandContextResult {
  ok: true
  context: ShopAdBrandContext
}
export interface DeriveBrandContextError {
  ok: false
  error: string
}

export async function deriveBrandContext(
  params: DeriveBrandContextParams,
): Promise<DeriveBrandContextResult | DeriveBrandContextError> {
  const { projectId, productIds } = params

  const [codeResult, secretsResult] = await Promise.all([
    supabaseAdmin
      .from('code_versions')
      .select('files')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('project_secrets')
      .select('merchant_json, market_country, market_language')
      .eq('project_id', projectId)
      .maybeSingle(),
  ])

  const files = (codeResult.data?.files ?? {}) as CodeVersionFiles
  if (Object.keys(files).length === 0) {
    // No generated code yet — there is nothing to build ad creative from. Distinct from
    // "config.ts didn't parse" below: this is a real precondition failure the caller
    // (POST /api/qads/campaigns) must surface before spending any credits.
    return { ok: false, error: 'Project has no generated store yet — generate a store before creating a campaign.' }
  }

  const parsedConfig = files[CONFIG_FILE] ? parseConfigFile(files[CONFIG_FILE]) : null
  // Degrades to sane defaults rather than failing the whole campaign — a store whose
  // config.ts deviates from the plain-literal shape (rare, but parseConfigFile documents
  // when it returns null) shouldn't block campaign creation entirely; it just means the
  // generated ad creative won't be on-brand until the merchant fixes the underlying
  // config.ts in the Studio. Surfaced to the caller via `usedDefaults`-style logging, not
  // silently — see the console.warn below.
  const config = parsedConfig ?? (DEFAULT_CONFIG as StoreConfig)
  if (!parsedConfig) {
    console.warn(`[qads/brand-context] data/config.ts for project ${projectId} did not parse as a plain StoreConfig literal — using neutral defaults.`)
  }

  const allProducts = files[PRODUCTS_FILE] ? parseProductsFile(files[PRODUCTS_FILE]) : null
  const scopedProducts = (allProducts ?? []).filter((p) => !productIds?.length || productIds.includes(p.id))

  const products: ShopAdBrandProduct[] = scopedProducts.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    images: p.images,
    slug: p.slug,
    available: p.available,
    tags: p.tags,
  }))

  const merchant = (secretsResult.data?.merchant_json ?? null) as BusinessInfo | null
  const marketCountry = secretsResult.data?.market_country as string | null
  const marketLanguage = secretsResult.data?.market_language as string | null

  const pastExperimentNotes = await readPastExperimentNotes(projectId)

  const context: ShopAdBrandContext = {
    brand: {
      name: config.brand.name,
      tagline: config.brand.tagline ?? '',
      logoText: config.brand.logoText,
    },
    market: {
      currency: config.brand.currency,
      // project_secrets market_* is the merchant's explicit override (Publish panel);
      // falls back to whatever config.ts was generated with, same precedence
      // /api/quante/generate already uses for these two fields.
      language: marketLanguage || config.brand.language,
      country: marketCountry || config.brand.country,
    },
    design: config.design,
    voiceGuess: guessVoice(config, products),
    products,
    businessCountry: merchant?.country || undefined,
    pastExperimentNotes: pastExperimentNotes.length ? pastExperimentNotes : undefined,
  }

  return { ok: true, context }
}

// No source in this codebase captures brand "voice" (StoreConfig has no such field —
// confirmed against types/store-code.ts and lib/store-health.ts; the legacy ShopManifest
// BrandVoice union in types/manifest.ts belongs to the deprecated manifest-driven model).
// This is therefore a heuristic starting point ONLY — always shown as editable in
// CampaignWizard before any generation call spends a credit, never presented as a fact
// the merchant didn't confirm. Kept intentionally simple (tagline length + price tier)
// rather than an extra Claude call, since a wrong guess costs nothing (the merchant just
// corrects it) and every pipeline node re-reads it from the frozen context either way.
function guessVoice(config: StoreConfig, products: ShopAdBrandProduct[]): ShopAdBrandContext['voiceGuess'] {
  const tagline = config.brand.tagline ?? ''
  const avgPrice = products.length ? products.reduce((sum, p) => sum + p.price, 0) / products.length : 0
  if (avgPrice > 150) return 'luxury'
  if (/\b(code|api|tech|software|app)\b/i.test(tagline) || /\b(code|api|tech|software|app)\b/i.test(config.brand.name)) return 'technical'
  if (tagline.length > 60) return 'editorial'
  if (/[!?]{1,}$/.test(tagline.trim())) return 'playful'
  return 'minimal'
}

// Concluded qads_experiments findings feed back into future strategy prompts (§8 of the
// proposal — "zjištění z ukončených testů vracej zpět do promptů"). Guarded with a
// try/catch + graceful empty-array fallback because this runs from campaign #2 onward,
// against a migration that may legitimately not exist yet in a given environment (Phase 1
// ships the schema as a file only, per project safety rules — see migration-qads.sql
// header) or may simply have zero concluded experiments for a new project. Mirrors the
// missing-table tolerance pattern in lib/fulfillment/auto-ship.ts (42P01).
async function readPastExperimentNotes(projectId: string): Promise<string[]> {
  try {
    const { data: campaigns } = await supabaseAdmin
      .from('qads_campaigns')
      .select('id')
      .eq('project_id', projectId)
    const campaignIds = (campaigns ?? []).map((c) => c.id as string)
    if (!campaignIds.length) return []

    const { data: experiments, error } = await supabaseAdmin
      .from('qads_experiments')
      .select('type, success_metric, result')
      .in('campaign_id', campaignIds)
      .eq('status', 'concluded')
      .order('updated_at', { ascending: false })
      .limit(10)
    if (error) return []

    return (experiments ?? [])
      .map((e) => {
        const result = e.result as { winnerVariantId?: string; confidence?: number } | null
        if (!result?.winnerVariantId) return null
        const confidencePct = result.confidence ? Math.round(result.confidence * 100) : null
        return `${e.type} test on ${e.success_metric}: variant ${result.winnerVariantId} won${confidencePct ? ` (${confidencePct}% confidence)` : ''}.`
      })
      .filter((n): n is string => n !== null)
  } catch {
    return []
  }
}
