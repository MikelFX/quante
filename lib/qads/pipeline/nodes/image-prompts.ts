// One batched Claude call: every ad needing a static creative -> one image-generation
// prompt each. Runs on ITERATION_MODEL (cheap) since it's working from copy that already
// exists, not creating strategy from scratch. Same JSON-fence-stripping + zod validation
// approach as strategy.ts, without the auto-repair pass (a malformed prompt for one ad is
// a leaf-node problem, not worth a second model call — see runner behavior in images.ts).

import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { ImagePromptOutputSchema, IMAGE_PROMPT_SYSTEM_PROMPT, buildImagePromptUserMessage, type ImagePromptOutput } from '../../claude/prompts'
import type { ShopAdBrandContext } from '../../types'

export interface ImagePromptAdInput {
  adId: string
  format: string
  texts: { headline: string; primaryText: string }
  productName: string
  productDescription: string
}

export type RunImagePromptsResult =
  | { ok: true; prompts: ImagePromptOutput['prompts'] }
  | { ok: false; error: string }

function extractJson(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '').trim()
}

export async function runImagePromptsNode(params: {
  brandContext: ShopAdBrandContext
  ads: ImagePromptAdInput[]
}): Promise<RunImagePromptsResult> {
  if (!params.ads.length) return { ok: true, prompts: [] }

  let rawText: string
  try {
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 4096,
      system: IMAGE_PROMPT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildImagePromptUserMessage(params) }],
    })
    rawText = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  } catch (err) {
    console.error('[qads/image-prompts] Claude API error:', err)
    return { ok: false, error: 'image_prompt_generation_failed' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(rawText))
  } catch {
    return { ok: false, error: 'invalid_json' }
  }

  const result = ImagePromptOutputSchema.safeParse(parsed)
  if (!result.success) return { ok: false, error: result.error.message }

  return { ok: true, prompts: result.data.prompts }
}
