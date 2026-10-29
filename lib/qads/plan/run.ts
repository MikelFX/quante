// Qads Plan — the one model call (server only). Structured output (PLAN_SCHEMA), streamed because
// the SDK refuses long non-streaming calls; only the final message is used and then normalized.
import 'server-only'
import { anthropic, MODELS, messageText } from '@/lib/claude'
import { PLAN_SCHEMA, PLAN_SYSTEM, normalizePlan, type Plan, type PlanInput } from './model'

const PLAN_TIMEOUT_MS = 200_000

export type PlanRun = { ok: true; plan: Plan } | { ok: false; error: string }

export async function runPlan(
  message: string,
  ctx: { input: PlanInput; productNames: string[]; competitorAdIds: string[] },
): Promise<PlanRun> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PLAN_TIMEOUT_MS)
  try {
    const msg = await anthropic.messages
      .stream(
        {
          model: MODELS.iteration,
          max_tokens: 32000,
          system: [{ type: 'text', text: PLAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: message }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
        },
        { signal: ctrl.signal },
      )
      .finalMessage()
    if ((msg.stop_reason as string) === 'refusal') return { ok: false, error: 'Qads could not write a plan for this store.' }
    if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'The plan was too long to finish. Try fewer ads or days.' }
    let parsed: unknown
    try {
      parsed = JSON.parse(messageText(msg))
    } catch {
      return { ok: false, error: 'The plan came back unreadable. Try again.' }
    }
    return { ok: true, plan: normalizePlan(parsed, ctx) }
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, error: 'Writing the plan took too long. Try again.' }
    console.error('[qads/plan] model call failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Writing the plan failed. Try again in a moment.' }
  } finally {
    clearTimeout(timer)
  }
}
