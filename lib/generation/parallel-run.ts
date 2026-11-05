// Runs a parallel generation (lib/generation/parallel.ts): the foundation stream, then every page
// writer at the same time. Server-only; called by runGeneration (lib/generation/run.ts) when the
// request asked for it. Returns null when the foundation could not be written, so the caller falls
// back to the ordinary one-stream generation; page writers that fail are retried once on the
// fallback model while there is time.
import { anthropic, MODELS, SYSTEM_PROMPT_CODE_GENERATION } from '@/lib/claude'
import { extractFileBlocks } from '@/lib/generation-checkpoint'
import {
  PARALLEL_PARTS,
  foundationComplete,
  foundationMessage,
  mergeParallelOutput,
  partMessage,
  type ParallelPart,
} from '@/lib/generation/parallel'

const MAX_TOKENS_FOUNDATION = 64000
const MAX_TOKENS_PART = 64000
/** a page writer that fails with less time than this left is not retried */
const RETRY_MIN_MS = 60_000

interface StreamResult { text: string; ok: boolean; refusal: boolean; aborted: boolean }

async function streamOnce(model: string, message: string, maxTokens: number, deadline: number, onText: (t: string) => void): Promise<StreamResult> {
  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_GENERATION, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: message }],
  })
  let text = ''
  let aborted = false
  const timer = setTimeout(() => { aborted = true; stream.abort() }, Math.max(1_000, deadline - Date.now()))
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
        onText(text)
      }
    }
  } catch {
    clearTimeout(timer)
    return { text, ok: false, refusal: false, aborted }
  }
  clearTimeout(timer)
  try {
    const final = await stream.finalMessage()
    if ((final.stop_reason as string) === 'refusal') return { text: '', ok: false, refusal: true, aborted: false }
  } catch {
    // non-fatal after a completed stream
  }
  return { text, ok: true, refusal: false, aborted: false }
}

export interface ParallelRunResult { raw: string; model: string }

/**
 * @param deadline   epoch ms by which every stream must have stopped (the generation's soft timeout)
 * @param checkpoint called every few seconds with the merged raw output so far
 */
export async function runParallelGeneration(
  brief: string,
  deadline: number,
  checkpoint: (raw: string, model: string) => Promise<void>,
  intervalMs: number,
): Promise<ParallelRunResult | null> {
  const primary = MODELS.generation
  const fallback = MODELS.fallback
  let model: string = primary

  // --- 1. foundation (one writer) ---
  let foundationRaw = ''
  const parts: Array<{ part: ParallelPart; raw: string }> = PARALLEL_PARTS.map((part) => ({ part, raw: '' }))
  const merged = () => mergeParallelOutput(foundationRaw, parts)

  let lastSaved = ''
  const save = async () => {
    const raw = merged()
    if (raw === lastSaved) return
    lastSaved = raw
    await checkpoint(raw, model)
  }
  const ticker = setInterval(() => { void save() }, intervalMs)

  try {
    // the foundation may use at most ~45 % of the time, so the page writers keep enough
    const foundationDeadline = Date.now() + Math.max(30_000, (deadline - Date.now()) * 0.45)
    let f = await streamOnce(primary, foundationMessage(brief), MAX_TOKENS_FOUNDATION, foundationDeadline, (t) => { foundationRaw = t })
    if (!f.ok && !f.aborted && foundationDeadline - Date.now() > RETRY_MIN_MS) {
      model = fallback
      foundationRaw = ''
      f = await streamOnce(fallback, foundationMessage(brief), MAX_TOKENS_FOUNDATION, foundationDeadline, (t) => { foundationRaw = t })
    }
    const foundation = extractFileBlocks(f.text)
    if (!foundationComplete(foundation)) return null
    foundationRaw = f.text

    // --- 2. every page writer at the same time ---
    await Promise.all(parts.map(async (slot) => {
      const message = partMessage(brief, foundation, slot.part)
      const r = await streamOnce(primary, message, MAX_TOKENS_PART, deadline, (t) => { slot.raw = t })
      if (r.ok || r.aborted || deadline - Date.now() < RETRY_MIN_MS) return
      slot.raw = ''
      model = fallback
      await streamOnce(fallback, message, MAX_TOKENS_PART, deadline, (t) => { slot.raw = t })
    }))
    await save()
    return { raw: merged(), model }
  } finally {
    clearInterval(ticker)
  }
}
