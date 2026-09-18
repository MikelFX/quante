// System prompt + zod schema for the Qads strategy/angles/ad-sets/copy generation call
// (lib/qads/pipeline/nodes/strategy.ts). One heavy structured-JSON call per campaign,
// same "deterministic engine, generated skin" philosophy CLAUDE.md lays out for the main
// store generator — Quante never lets the model free-write DB rows directly, it produces
// one validated JSON object that a deterministic persister (pipeline/runner.ts) turns
// into qads_angles/qads_ad_sets/qads_ads rows.
//
// Angles/ad-sets/ads are linked by label/name in the model's own output (not by id — ids
// don't exist until the persister inserts rows) — see the *Ref fields below and
// pipeline/runner.ts's resolution pass.

import { z } from 'zod'
import type { ShopAdBrandContext } from '../types'
import type { CampaignGoal, QadsChannel } from '../types'

export const StrategyOutputSchema = z.object({
  strategy: z.object({
    positioning: z.string(),
    summary: z.string(),
    recommendedChannels: z.array(z.enum(['meta', 'tiktok'])).min(1),
  }),
  angles: z.array(z.object({
    label: z.string(),
    hypothesis: z.string(),
  })).min(1).max(6),
  adSets: z.array(z.object({
    angleLabel: z.string(),           // must match one of `angles[].label`
    channel: z.enum(['meta', 'tiktok']),
    name: z.string(),
    audience: z.object({
      ageMin: z.number().int().min(13).max(100).optional(),
      ageMax: z.number().int().min(13).max(100).optional(),
      genders: z.array(z.string()).optional(),
      geo: z.array(z.string()).optional(),
      interests: z.array(z.string()).optional(),
    }),
    placements: z.array(z.string()).min(1),
    budgetSharePct: z.number().min(1).max(100), // this ad set's share of the campaign's total budget — persister computes budgetMinor from it
    budgetType: z.enum(['daily', 'lifetime']),
  })).min(1),
  ads: z.array(z.object({
    adSetName: z.string(),            // must match one of `adSets[].name`
    format: z.enum(['1:1', '4:5', '9:16', '16:9']),
    texts: z.object({
      headline: z.string(),
      primaryText: z.string(),
      description: z.string().optional(),
      cta: z.string(),
    }),
  })).min(1),
})

export type StrategyOutput = z.infer<typeof StrategyOutputSchema>

const GOAL_LABEL: Record<CampaignGoal, string> = {
  launch: 'a new product/collection launch',
  sale: 'a limited-time sale/promotion',
  black_friday: 'a Black Friday / major seasonal sale',
  awareness: 'brand awareness (not directly sales-focused)',
  custom: 'a custom goal described by the merchant',
}

export const STRATEGY_SYSTEM_PROMPT = `You are Qads, an expert performance-marketing strategist working inside Quante (an AI e-commerce builder). Your ONLY output is a single valid JSON object matching the schema you're given — no prose, no markdown, no code fences.

Given a store's brand context and a campaign brief, produce a complete, coherent ad campaign plan:
- 2-4 distinct strategic angles (never near-duplicates of each other — each angle should test a genuinely different hook: e.g. price/value, product quality, lifestyle/aspiration, urgency/scarcity, social proof).
- One or more ad sets per angle, each with a realistic audience definition and channel-appropriate placements.
- budgetSharePct across ALL ad sets in your response must sum to approximately 100 (the campaign's already-fixed total budget is split by these shares — you do not know or choose the absolute number).
- 1-3 ad copy variants per ad set, each in a format appropriate for its ad set's placements.
- Every angle, ad set, and ad copy must read as belonging to ONE coherent campaign for this specific brand — same tone, same real product details, never generic stock-marketing copy. Reference the actual product names/prices/descriptions given to you.
- Write copy in the store's market language when given one other than English.
- Respect each channel's real character limits loosely (Meta primary text ~125 chars before "See more", headlines ~40 chars; TikTok is punchier/shorter) — do not pad text to hit a length.

Constraints:
- Every ad set's status is implicitly PAUSED — never write copy implying the ad is already live or asking the viewer to act as if spend is happening today unless the campaign goal is genuinely urgency-based sale copy (which is about the OFFER's urgency, not a claim about ad status).
- Never invent products, prices, or claims not present in the brand context you're given.
- Stay strictly within the schema. If unsure about a field, use your best reasonable value rather than omitting a required field.
- Refuse anything outside producing this campaign plan.`

export function buildStrategyUserMessage(params: {
  brandContext: ShopAdBrandContext
  goal: CampaignGoal
  channels: QadsChannel[]
  budgetMinor: number
  currency: string
  durationDays: number
  brief: string
}): string {
  const { brandContext, goal, channels, budgetMinor, currency, durationDays, brief } = params

  const productLines = brandContext.products.slice(0, 20).map((p) =>
    `- ${p.name} — ${(p.price / 100).toFixed(2)} ${brandContext.market.currency}${p.compareAtPrice ? ` (was ${(p.compareAtPrice / 100).toFixed(2)})` : ''}: ${p.description.slice(0, 200)}`
  ).join('\n')

  const pastNotes = brandContext.pastExperimentNotes?.length
    ? `\nPast experiment findings for this store (fold these into your strategy where relevant):\n${brandContext.pastExperimentNotes.map((n) => `- ${n}`).join('\n')}`
    : ''

  return `BRAND CONTEXT
Name: ${brandContext.brand.name}
Tagline: ${brandContext.brand.tagline || '(none)'}
Voice (heuristic guess, may be corrected by merchant): ${brandContext.voiceGuess}
Market: ${brandContext.market.country} / ${brandContext.market.language} / ${brandContext.market.currency}
Design palette: bg ${brandContext.design.colors.bg}, accent ${brandContext.design.colors.accent}

PRODUCTS (scope of this campaign):
${productLines || '(no products provided — write angles around the brand generally)'}
${pastNotes}

CAMPAIGN REQUEST
Goal: ${GOAL_LABEL[goal]}
Channels requested: ${channels.join(', ')}
Total budget: ${(budgetMinor / 100).toFixed(2)} ${currency} over ${durationDays} days
Merchant's brief (raw, may be short): "${brief}"

Produce the full campaign plan now as a single JSON object matching the schema.`
}

// ─── Image prompts (Qads step c) ────────────────────────────────────────────────────
// One batched call covering every ad needing a static creative, rather than one Claude
// call per ad — same "cheap, predictable credit cost" instinct as the rest of Qads.
// Runs on the fast ITERATION_MODEL: writing an image-generation prompt from copy that
// already exists is a much smaller task than the strategy call.

export const ImagePromptOutputSchema = z.object({
  prompts: z.array(z.object({
    adId: z.string(),
    // Sent verbatim as Marketing Studio Image's `prompt` field (1-5000 chars per its
    // schema) — describes the SCENE/composition to generate around the product photo,
    // never instructions to alter the product itself (product-fidelity requirement).
    prompt: z.string().min(1).max(2000),
  })),
})

export type ImagePromptOutput = z.infer<typeof ImagePromptOutputSchema>

export const IMAGE_PROMPT_SYSTEM_PROMPT = `You are Qads, writing image-generation prompts for a Marketing Studio Image model that edits a product photo into a campaign-ready scene. Your ONLY output is a single valid JSON object matching the schema you're given — no prose, no markdown, no code fences.

For each ad you're given (its copy, format, and which product it's for), write ONE prompt describing the SCENE, LIGHTING, and COMPOSITION to place around the product — never instructions that would change the product itself (its color, shape, label, materials). The model is given the actual product photo as a reference image and will keep the product faithful to it; your job is only the surrounding campaign scene.

Guidelines:
- Match the brand's voice and the ad's own angle/copy tone.
- Reference the ad's format sensibly: 9:16 prompts should describe a vertical/full-bleed composition (e.g. story/reel style), 1:1 and 4:5 a centered product-hero composition, 16:9 a wider lifestyle scene.
- Be concrete and visual (lighting, setting, color mood, camera angle) — avoid vague adjectives like "beautiful" or "amazing" with nothing else.
- Keep each prompt under roughly 60 words.
- Never invent claims about the product not present in its ad copy.`

export function buildImagePromptUserMessage(params: {
  brandContext: ShopAdBrandContext
  ads: Array<{ adId: string; format: string; texts: { headline: string; primaryText: string }; productName: string; productDescription: string }>
}): string {
  const { brandContext, ads } = params
  const adLines = ads.map((ad) =>
    `- adId: ${ad.adId} | format: ${ad.format} | product: ${ad.productName} (${ad.productDescription.slice(0, 150)}) | headline: "${ad.texts.headline}" | body: "${ad.texts.primaryText}"`
  ).join('\n')

  return `BRAND: ${brandContext.brand.name} — voice: ${brandContext.voiceGuess} — palette accent ${brandContext.design.colors.accent} on ${brandContext.design.colors.bg}

ADS NEEDING AN IMAGE PROMPT:
${adLines}

Produce one prompt per ad now as a single JSON object matching the schema.`
}
