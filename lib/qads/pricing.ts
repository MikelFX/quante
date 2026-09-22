// Qads generator pricing — single source of truth for model IDs, USD costs, and
// the credit price a user sees before hitting "Vygenerovat". Every USD number
// below has a docs URL as evidence — never hardcode a price without one, and
// bump the comment date when you re-check.
//
// Blended credit price used for markup math: $0.15/credit, from the current
// CREDIT_PACKS (Starter $9.99/50 = $0.20, Builder $24.99/150 = $0.17,
// Studio $69.99/500 = $0.14). Not a user-visible number — just the divisor for
// deciding how many credits an operation should cost.

// ─── Higgsfield models Qads uses ──────────────────────────────────────
// Confirmed pinned models — see lib/qads/media/providers/higgsfield/mapper.ts
// for the exact request-body shape each accepts. The mapper is model-agnostic
// on Qads's side; only the (endpoint path, price) pair lives here.
export const HIGGSFIELD_MODELS = {
  image: {
    // Higgsfield Marketing Studio Image — purpose-built for product-photo ->
    // campaign-ready hero shots. Endpoint POST /marketing-studio/image.
    slug: 'higgsfield/marketing-studio-image',
    // USD $0.0162/image (verified 2026-09-22 at open.higgsfield.ai model
    // discovery page). Price ceiling — actual invoice may be lower during
    // promo periods.
    usdPerUnit: 0.0162,
    unit: 'image' as const,
  },
  video: {
    // ByteDance Seedance 2.5 Reference-to-Video via Higgsfield. Endpoint
    // POST /bytedance/seedance-2.5/reference-to-video. Chosen over
    // Lightricks LTX because Seedance is what the existing mapper.ts is
    // already wired against; both accept the same product-photo -> short
    // ad video shape.
    slug: 'higgsfield/seedance-2.5-reference-to-video',
    // USD $0.09/second — placeholder pending an explicit confirmation from
    // Higgsfield's billing dashboard. Same order of magnitude as Lightricks
    // LTX 2.5 Fast (docs list $0.09/s+); update this once the first real
    // invoice lands.
    usdPerUnit: 0.09,
    unit: 'video_second' as const,
  },
} as const

export type HiggsfieldOutputKind = 'image' | 'video'

// ─── Credit costs shown to the user ───────────────────────────────────
// All Qads-generator credit numbers live here. Never inline these at a call
// site. Same pattern CREDIT_COSTS in lib/config.ts uses.
export const QADS_GENERATOR_CREDIT_COSTS = {
  // 1 credit ≈ $0.15 gross → $0.0162 USD image cost ≈ 0.1 credit → floor
  // clamped at 1 so we never charge 0. Effective markup ≈ 9×, high because
  // this operation includes a per-variant Claude prompt-crafting call too
  // (the Claude call is priced in via `strategy_per_generation` below).
  imagePerVariant: 1,
  // Video price scales with the requested duration — $0.09/s at 4-10s a
  // reasonable ad length gives $0.36–$0.90 in raw compute; charging 6
  // credits per 5s (i.e. ~1.2 credits/s) puts effective markup at ~2×, which
  // matches Studio's per-second generation charge from CREDIT_COSTS.
  videoPerSecond: 1.2,
  // Fixed per-generation charge for the Claude-driven prompt + ad-copy build
  // (one bulk call for all formats/variants in one submit). Same shape as
  // QADS_CREDIT_COSTS.strategy_generation in the old lib/qads/credits.ts.
  strategyPerGeneration: 3,
} as const

export interface GeneratorCostInput {
  outputTypes: HiggsfieldOutputKind[]  // any of 'image'|'video'
  formats: string[]                     // 1–4 of '9:16'|'4:5'|'1:1'|'16:9'
  variantsPerFormat: number             // 1–4
  videoDurationSeconds: number          // meaningful only when 'video' in outputTypes
}

export interface GeneratorCostBreakdown {
  imageCredits: number
  videoCredits: number
  strategyCredits: number
  totalCredits: number
  // USD estimate (compute-only, no Claude/infra) — mirrored in the UI as a
  // small "cost to us" annotation when running as an admin, hidden for
  // normal users.
  usdEstimate: number
}

// Priced from concrete form inputs. Pure — no DB, no clock; safe to call from
// both server and client so the price preview in the /qads form matches the
// price the API charges.
export function computeGeneratorCost(input: GeneratorCostInput): GeneratorCostBreakdown {
  const { outputTypes, formats, variantsPerFormat, videoDurationSeconds } = input
  const wantImages = outputTypes.includes('image')
  const wantVideos = outputTypes.includes('video')
  const formatCount = formats.length
  const variantsTotal = formatCount * variantsPerFormat

  const imageCredits = wantImages
    ? variantsTotal * QADS_GENERATOR_CREDIT_COSTS.imagePerVariant
    : 0
  const videoCredits = wantVideos
    ? Math.ceil(variantsTotal * QADS_GENERATOR_CREDIT_COSTS.videoPerSecond * videoDurationSeconds)
    : 0
  const strategyCredits = QADS_GENERATOR_CREDIT_COSTS.strategyPerGeneration

  const imageUsd = wantImages
    ? variantsTotal * HIGGSFIELD_MODELS.image.usdPerUnit
    : 0
  const videoUsd = wantVideos
    ? variantsTotal * HIGGSFIELD_MODELS.video.usdPerUnit * videoDurationSeconds
    : 0

  return {
    imageCredits,
    videoCredits,
    strategyCredits,
    totalCredits: imageCredits + videoCredits + strategyCredits,
    usdEstimate: Number((imageUsd + videoUsd).toFixed(3)),
  }
}

// The per-item credit charge stored on qads_items.credits_charged, so a single
// failed item can refund its own cost without the caller needing to re-do the
// arithmetic. Same math as computeGeneratorCost but on a single (kind, format,
// variant) slot.
export function creditsPerItem(kind: HiggsfieldOutputKind, videoDurationSeconds: number): number {
  if (kind === 'image') return QADS_GENERATOR_CREDIT_COSTS.imagePerVariant
  return Math.ceil(QADS_GENERATOR_CREDIT_COSTS.videoPerSecond * videoDurationSeconds)
}
