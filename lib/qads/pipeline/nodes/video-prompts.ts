// Mirrors image-prompts.ts exactly, using the video-specific system prompt (camera
// movement/motion language instead of static composition) — see
// lib/qads/claude/prompts.ts VIDEO_PROMPT_SYSTEM_PROMPT for why this is a separate
// prompt rather than reusing the image one despite the identical output schema.

import { anthropic, ITERATION_MODEL } from '@/lib/claude'
import { ImagePromptOutputSchema, VIDEO_PROMPT_SYSTEM_PROMPT, buildVideoPromptUserMessage, type ImagePromptOutput } from '../../claude/prompts'
import type { ShopAdBrandContext } from '../../types'
import type { ImagePromptAdInput } from './image-prompts'

export type RunVideoPromptsResult =
  | { ok: true; prompts: ImagePromptOutput['prompts'] }
  | { ok: false; error: string }

function extractJson(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '').trim()
}

export async function runVideoPromptsNode(params: {
  brandContext: ShopAdBrandContext
  ads: ImagePromptAdInput[]
}): Promise<RunVideoPromptsResult> {
  if (!params.ads.length) return { ok: true, prompts: [] }

  let rawText: string
  try {
    const msg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 4096,
      system: VIDEO_PROMPT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildVideoPromptUserMessage(params) }],
    })
    rawText = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  } catch (err) {
    console.error('[qads/video-prompts] Claude API error:', err)
    return { ok: false, error: 'video_prompt_generation_failed' }
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
