// The one heavy Claude call in the Qads pipeline: brand context + campaign brief ->
// strategy + angles + ad sets + ad copy, as one validated JSON object. Runs on
// MODELS.generation (same top-tier model as the main store generator) since this is the
// creative/strategic core of the campaign, not a cheap patch.
//
// Mirrors app/api/quante/vision/route.ts's call shape (system prompt, JSON-fence
// stripping, JSON.parse) but adds the zod validation + one auto-repair call CLAUDE.md
// specifies for manifest-shaped generation ("On invalid JSON, attempt one auto-repair
// call before surfacing an error").

import { anthropic, MODELS, ITERATION_MODEL } from '@/lib/claude'
import { StrategyOutputSchema, STRATEGY_SYSTEM_PROMPT, buildStrategyUserMessage, type StrategyOutput } from '../../claude/prompts'
import type { ShopAdBrandContext, CampaignGoal, QadsChannel } from '../../types'

export interface RunStrategyNodeParams {
  brandContext: ShopAdBrandContext
  goal: CampaignGoal
  channels: QadsChannel[]
  budgetMinor: number
  currency: string
  durationDays: number
  brief: string
}

export type RunStrategyNodeResult =
  | { ok: true; output: StrategyOutput }
  | { ok: false; error: string }

function extractJson(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '').trim()
}

export async function runStrategyNode(params: RunStrategyNodeParams): Promise<RunStrategyNodeResult> {
  const userMessage = buildStrategyUserMessage(params)

  let rawText: string
  try {
    const msg = await anthropic.messages.create({
      model: MODELS.generation,
      max_tokens: 8192,
      system: STRATEGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    rawText = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
  } catch (err) {
    console.error('[qads/strategy] Claude API error:', err)
    return { ok: false, error: 'strategy_generation_failed' }
  }

  const firstAttempt = tryParseAndValidate(rawText)
  if (firstAttempt.ok) return firstAttempt

  // One auto-repair pass, per CLAUDE.md's standing rule for manifest-shaped output — send
  // the malformed output + the exact validation error back on the cheap/fast model and
  // ask for a corrected JSON object, rather than immediately failing (and refunding) the
  // whole campaign generation over what's usually a small schema slip.
  console.warn('[qads/strategy] first attempt failed validation, attempting one repair:', firstAttempt.error)
  let repairedText: string
  try {
    const repairMsg = await anthropic.messages.create({
      model: ITERATION_MODEL,
      max_tokens: 8192,
      system: 'You repair malformed JSON to match a given schema. Output ONLY the corrected JSON object — no prose, no markdown, no code fences.',
      messages: [{
        role: 'user',
        content: `This JSON output failed schema validation with error:\n${firstAttempt.error}\n\nOriginal output:\n${rawText}\n\nReturn a corrected JSON object that fixes the validation error while preserving as much of the original content as possible.`,
      }],
    })
    repairedText = repairMsg.content[0]?.type === 'text' ? repairMsg.content[0].text.trim() : ''
  } catch (err) {
    console.error('[qads/strategy] repair call failed:', err)
    return { ok: false, error: 'strategy_generation_failed_unrepairable' }
  }

  const secondAttempt = tryParseAndValidate(repairedText)
  if (secondAttempt.ok) return secondAttempt

  console.error('[qads/strategy] repair attempt also failed validation:', secondAttempt.error)
  return { ok: false, error: 'strategy_generation_failed_unrepairable' }
}

function tryParseAndValidate(raw: string): RunStrategyNodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJson(raw))
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
  const result = StrategyOutputSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true, output: result.data }
}
