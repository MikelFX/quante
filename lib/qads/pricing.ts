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
    // Rendered at 1080p, 4–30 s (owner 2026-10-29: "1080p up to 30 s, expensive is fine,
    // keep a small margin"). USD ~$1.05/second at 1080p, silent: the console showed
    // $0.32–0.46/s at 720p (checked 2026-10-28) and Higgsfield prices 1080p at 128 vs 56
    // credits per 8 s clip (higgsfield.ai/blog/seedance-2-5-pricing-2026) = 2.29× 720p, so
    // 0.46 × 2.29 ≈ $1.05. Re-check against the first real invoice. The old $0.09/s was a
    // placeholder and made every video a loss.
    usdPerUnit: 1.05,
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
  // Video price scales with the requested duration. Seedance 1080p costs ~$1.05/s;
  // 9 credits/s = $1.215/s at the cheapest net credit (USD_PER_CREDIT_FLOOR, +16 %)
  // and $1.35/s at the blended $0.15/credit (+29 %) — a small margin by the owner's
  // choice, never below cost (__tests__/qads-pricing.test.mjs). Was 1.2 credits/s
  // on the $0.09 placeholder at 720p.
  videoPerSecond: 9,
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
  // Duplicate formats are one slot, not two — must match how the API builds items.
  const formatCount = new Set(formats).size
  const variantsTotal = formatCount * variantsPerFormat

  // Totals are exactly Σ creditsPerItem over the slots, so the reservation always
  // equals the sum of per-item charges (+ strategy) and per-item refunds can
  // never exceed what was reserved.
  const imageCredits = wantImages
    ? variantsTotal * creditsPerItem('image', 0)
    : 0
  const videoCredits = wantVideos
    ? variantsTotal * creditsPerItem('video', videoDurationSeconds)
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
  // Never 0: a missing/invalid duration must not make a video free.
  const seconds = Number.isFinite(videoDurationSeconds) ? Math.max(0, videoDurationSeconds) : 0
  return Math.max(1, Math.ceil(QADS_GENERATOR_CREDIT_COSTS.videoPerSecond * seconds))
}

// ─── Character + Tiktoker (AI creator talks about the product) ─────────
// Two Higgsfield models (prices from console.higgsfield.ai model pages, checked 2026-10-28):
//   • Character = Higgsfield AI Influencer (POST /higgsfield/ai-influencer): one character
//     sheet, $0.05 per sheet.
//   • Tiktoker video = Wan 3.0 Reference to Video (POST /alibaba/wan-3.0/reference-to-video),
//     native audio, so the character speaks the script with lip sync. List price per output
//     second: 480p $0.05, 720p $0.10, 1080p $0.20; the console currently shows a 60 % discount
//     (720p ≈ $0.04/s) with no end date. Higgsfield's own "Marketing Studio" UGC video is not
//     in the public API (docs.higgsfield.ai catalog, 2026-10-28) — Wan 3.0 is the documented
//     model with image references + generated speech. Seedance 2.5 does the same at
//     ~$0.46/s list (720p), too expensive for a 15 s clip.
export const TIKTOKER_MODELS = {
  character: {
    slug: 'higgsfield/ai-influencer',
    usdPerSheet: 0.05,
  },
  video: {
    slug: 'higgsfield/wan-3.0-reference-to-video',
    resolution: '720p' as const,
    usdPerSecondList: 0.10,
    // What Higgsfield charges right now (list price minus the console's current discount).
    usdPerSecondNow: 0.04,
  },
  // The script is one short Claude call (MODELS.intake) with the product photo.
  scriptUsd: 0.03,
} as const

export const TIKTOKER_DURATIONS = [10, 15] as const
export type TiktokerDuration = (typeof TIKTOKER_DURATIONS)[number]

// What one credit brings in at worst: the cheapest pack (Studio $69.99 / 500) after Stripe's
// 2.9 % + $0.30 ≈ $0.135. The launch price divides our cost by this, so even the cheapest
// credit covers it — at cost, no margin.
export const USD_PER_CREDIT_FLOOR = 0.135

// Launch offer (owner, 2026-10-28): 30 days at cost — the company earns nothing on it yet.
// Prague midnights, in UTC.
export const TIKTOKER_LAUNCH = {
  startsAt: '2026-10-28T23:00:00Z',
  endsAt: '2026-11-27T23:00:00Z',
} as const

export function isTiktokerLaunch(now: Date = new Date()): boolean {
  const t = now.getTime()
  return t >= Date.parse(TIKTOKER_LAUNCH.startsAt) && t < Date.parse(TIKTOKER_LAUNCH.endsAt)
}

// After the launch: about 2× the list cost at the blended $0.15/credit, the same markup the
// other Qads videos aim for.
export const TIKTOKER_CREDIT_COSTS = {
  characterPerSheet: 1,
  videoPerSecond: 1.4,
  scriptPerGeneration: 2,
} as const

const atCost = (usd: number) => Math.max(1, Math.ceil(usd / USD_PER_CREDIT_FLOOR - 1e-9))

/** Credits for one character sheet. Never 0. */
export function characterCredits(now: Date = new Date()): number {
  return isTiktokerLaunch(now) ? atCost(TIKTOKER_MODELS.character.usdPerSheet) : TIKTOKER_CREDIT_COSTS.characterPerSheet
}

/** Credits for one rendered Tiktoker clip (the video only, no script). Never 0. */
export function tiktokerVideoCredits(seconds: number, now: Date = new Date()): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  if (isTiktokerLaunch(now)) return atCost(TIKTOKER_MODELS.video.usdPerSecondNow * s)
  return Math.max(1, Math.ceil(TIKTOKER_CREDIT_COSTS.videoPerSecond * s - 1e-9))
}

export function tiktokerScriptCredits(now: Date = new Date()): number {
  return isTiktokerLaunch(now) ? atCost(TIKTOKER_MODELS.scriptUsd) : TIKTOKER_CREDIT_COSTS.scriptPerGeneration
}

export interface TiktokerCost {
  videoCredits: number
  scriptCredits: number
  totalCredits: number
  /** Our cost in USD at today's Higgsfield price (+ the script call). */
  usdNow: number
  launch: boolean
}

/** Same arithmetic on server and client, like computeGeneratorCost. */
export function computeTiktokerCost(variants: number, seconds: number, now: Date = new Date()): TiktokerCost {
  const per = tiktokerVideoCredits(seconds, now)
  const videoCredits = per * variants
  const scriptCredits = tiktokerScriptCredits(now)
  return {
    videoCredits,
    scriptCredits,
    totalCredits: videoCredits + scriptCredits,
    usdNow: Number((variants * seconds * TIKTOKER_MODELS.video.usdPerSecondNow + TIKTOKER_MODELS.scriptUsd).toFixed(3)),
    launch: isTiktokerLaunch(now),
  }
}
