// Claude system prompt + Zod schema for the /qads generator's single bulk
// call: from (product photos, name, description, style, language) produce
// (a) one Higgsfield image prompt per format×variant slot, (b) one Higgsfield
// video prompt per format×variant slot (when video output is requested), and
// (c) matching ad-copy (hook / primary text / headline / CTA, plus video-only
// script and subtitles). Deterministic JSON — never free-form prose.
//
// Same "one heavy structured call → deterministic persister" shape the store
// generator + earlier campaign-era Qads used (see CLAUDE.md §4.1). Runs on
// GENERATION_MODEL because the whole payload is one round-trip; a cheaper
// model gets us weaker copy that costs more to iterate.

import { z } from 'zod'
import type { QadsStyleDefinition } from '../styles'

// ─── Output schema ──────────────────────────────────────────────────

// Fields are camelCase in the model output and get normalised to snake_case
// only when written to qads_ad_copy / qads_items — same convention the
// existing lib/qads schema follows.

export const ImagePromptItemSchema = z.object({
  format: z.enum(['1:1', '4:5', '9:16', '16:9']),
  variantIdx: z.number().int().min(0).max(3),
  prompt: z.string().min(20).max(1500),
})

export const VideoPromptItemSchema = z.object({
  format: z.enum(['1:1', '4:5', '9:16', '16:9']),
  variantIdx: z.number().int().min(0).max(3),
  prompt: z.string().min(20).max(1500),
})

export const AdCopyItemSchema = z.object({
  format: z.enum(['1:1', '4:5', '9:16', '16:9']),
  variantIdx: z.number().int().min(0).max(3),
  hook: z.string().min(2).max(120),
  primaryText: z.string().min(2).max(400),
  headline: z.string().min(2).max(60),
  cta: z.string().min(1).max(30),
  videoScript: z.string().max(600).optional(),
  subtitles: z.array(z.object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    text: z.string().min(1).max(120),
  })).optional(),
})

export const GeneratorPromptOutputSchema = z.object({
  imagePrompts: z.array(ImagePromptItemSchema),
  videoPrompts: z.array(VideoPromptItemSchema),
  adCopy: z.array(AdCopyItemSchema),
})

export type GeneratorPromptOutput = z.infer<typeof GeneratorPromptOutputSchema>

// ─── System prompt ──────────────────────────────────────────────────

export const GENERATOR_SYSTEM_PROMPT = `You are Qads, writing generation prompts and ad copy for a single product's advertising bundle. Your ONLY output is a single valid JSON object matching the schema you're given — no prose, no markdown, no code fences.

You are given:
- product photo(s), product name, product description
- a style directive that describes the visual language every generated image and video must follow
- the target aspect ratios (formats) and how many variants per format the user requested
- the target language for ad copy

Your job:
1. For each requested (format, variantIdx) slot in the IMAGE output, write ONE image-generation prompt describing the scene, lighting, composition and mood to build around the product photo. NEVER instruct the model to change the product itself (its colour, shape, label, materials) — the model receives the actual product photo as a reference and keeps it faithful; your job is only the surrounding scene.
2. For each (format, variantIdx) slot in the VIDEO output, write ONE video-generation prompt describing camera movement, motion and scene for a short clip built around the product photo. Same product-fidelity rule as images.
3. For each (format, variantIdx) slot, write ad copy in the requested language: a hook (attention grabber), primary text (~1-3 sentences), a short headline, and a call-to-action. For video slots, ALSO write a short shot-by-shot videoScript (Czech/English/etc as requested) and OPTIONAL subtitles (startMs/endMs in the clip's duration; only include if the video's duration is >= 5 seconds).

Style + language rules:
- Every image/video prompt must respect the style directive (studio packshot / lifestyle / UGC / cinematic / minimal) — this is not a suggestion, it's the visual through-line for the whole bundle.
- Variants within one format should feel genuinely different (different scene, different mood, different angle) — never near-duplicates of each other.
- Ad copy language matches the target language exactly. Ad copy must reference the product's real name and describe attributes visible in the description you were given — never invent claims, prices, or unrelated features.

Constraints:
- Stay strictly within the schema. Every slot the user requested must appear in the output — no gaps, no extras.
- Image/video prompts are English (the models perform better in English regardless of ad-copy language).
- Refuse anything outside producing this generator bundle.`

// ─── User message ──────────────────────────────────────────────────

const LANGUAGE_LABEL: Record<'cs' | 'en' | 'sk' | 'de', string> = {
  cs: 'Czech (cs)',
  en: 'English (en)',
  sk: 'Slovak (sk)',
  de: 'German (de)',
}

export interface BuildUserMessageInput {
  productName: string
  productDescription: string
  productPhotoUrls: string[]
  style: QadsStyleDefinition
  formats: Array<'1:1' | '4:5' | '9:16' | '16:9'>
  variantsPerFormat: number
  wantImages: boolean
  wantVideos: boolean
  videoDurationSeconds: number
  language: 'cs' | 'en' | 'sk' | 'de'
}

export function buildGeneratorUserMessage(input: BuildUserMessageInput): string {
  const {
    productName, productDescription, productPhotoUrls,
    style, formats, variantsPerFormat, wantImages, wantVideos,
    videoDurationSeconds, language,
  } = input

  const slots: string[] = []
  for (const format of formats) {
    for (let v = 0; v < variantsPerFormat; v++) {
      slots.push(`  { format: "${format}", variantIdx: ${v} }`)
    }
  }
  const slotsBlock = slots.join(',\n')

  const photoLines = productPhotoUrls
    .slice(0, 4)
    .map((url, i) => `- Photo ${i + 1}: ${url}`)
    .join('\n')

  const kinds: string[] = []
  if (wantImages) kinds.push('imagePrompts')
  if (wantVideos) kinds.push(`videoPrompts (each clip is ${videoDurationSeconds} seconds long)`)

  return `PRODUCT
Name: ${productName}
Description: ${productDescription || '(none provided — infer from photos)'}
Photos:
${photoLines}

STYLE DIRECTIVE
Style: ${style.label} (id: ${style.id})
Image directive: ${style.imageDirective}
Video directive: ${style.videoDirective}

OUTPUT REQUEST
Language for ad copy: ${LANGUAGE_LABEL[language]}
Formats requested: ${formats.join(', ')}
Variants per format: ${variantsPerFormat}
Kinds requested: ${kinds.join(' AND ')}
adCopy is ALWAYS required — one entry per (format, variantIdx) slot.

SLOTS (one entry per slot in imagePrompts / videoPrompts / adCopy):
[
${slotsBlock}
]

Produce the full bundle now as a single JSON object matching the schema. Remember: if the user did NOT request images, imagePrompts must be an empty array; same for videoPrompts. adCopy is always populated for every slot.`
}
