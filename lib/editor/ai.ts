// Visual editor v2 — "Create with AI" (2026-09-27). Server-only.
// The model writes ONE static JSX snippet for the selected spot; it is validated by the
// same rules as the ready-made blocks (lib/editor/snippet.ts) and, when it fails, gets
// one retry with the validation error. The caller applies it through applyEditorOp, so
// the result also passes the AI store-file filter before it is saved.

import { anthropic, ITERATION_MODEL, messageText, SYSTEM_PROMPT_CODE_ITERATION } from '@/lib/claude'
import { AI_FILTER_PROMPT_NOTE } from '@/lib/generation-checkpoint'
import { SNIPPET_ICONS, SNIPPET_TAGS, validateSnippet } from '@/lib/editor/snippet'

export type AiSnippetMode = 'after' | 'inside' | 'replace'

const SYSTEM = `You are Quante's visual editor assistant. You write ONE snippet of static JSX that is inserted into a Next.js + Tailwind CSS v4 store page.

OUTPUT: only the JSX — no prose, no markdown, no code fences, no imports, no explanations.

HARD RULES (anything else is rejected):
- Allowed tags: ${[...SNIPPET_TAGS].join(', ')}, Link (for internal links; href="/...") and these lucide icons as self-closing tags: ${[...SNIPPET_ICONS].join(', ')}.
- Attributes: className, href, src, alt, title, type, target, rel, id, aria-label, aria-hidden — values are plain string literals only. Icons may also take size={16} / strokeWidth={2} as numbers.
- NO JavaScript: no {expressions} (except a plain string like {"text"}), no event handlers (onClick …), no style={}, no spreads, no other components, no <script>/<iframe>/<form>/<input>.
- href: relative ("/collections/all") or https:// / mailto: / tel:. src: https:// or relative.
- Styling: Tailwind utility classes. For the store's brand use the theme tokens: bg-bg, bg-surface, bg-accent, text-text, text-muted, text-accent, text-accent-text, border-border, font-heading, font-body, rounded-store. Prefer them over hard-coded colors.
- Copy: real, specific text in the SAME language as the surrounding page. Never lorem ipsum.
- Match the look of the surrounding code (spacing scale, typography, button style).`

function modeText(mode: AiSnippetMode): string {
  if (mode === 'after') return 'Create a NEW element that will be placed directly AFTER the selected element (as its next sibling).'
  if (mode === 'inside') return 'Create a NEW element that will be added as the LAST CHILD inside the selected element.'
  return 'REWRITE the selected element according to the instruction. Output the complete replacement element. Keep its existing texts unless the instruction asks to change them.'
}

export async function generateEditorSnippet(opts: {
  mode: AiSnippetMode
  instruction: string
  elementSource: string
  fileSource: string
}): Promise<{ ok: true; snippet: string } | { ok: false; error: string }> {
  const file = opts.fileSource.length > 14000 ? opts.fileSource.slice(0, 14000) + '\n/* … truncated … */' : opts.fileSource
  const user = `PAGE FILE (for style and language reference):\n${file}\n\nSELECTED ELEMENT:\n${opts.elementSource.slice(0, 6000)}\n\nTASK: ${modeText(opts.mode)}\n\nMERCHANT'S INSTRUCTION:\n${opts.instruction}`

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: user }]
    if (attempt === 1) {
      messages.push({ role: 'assistant', content: lastError.split('\n\nREJECTED:')[0] })
      messages.push({ role: 'user', content: `That snippet was rejected: ${lastError.split('\n\nREJECTED:')[1] ?? 'invalid'}. Output a corrected snippet that follows every rule.` })
    }
    const msg = await anthropic.messages.create({ model: ITERATION_MODEL, max_tokens: 12000, output_config: { effort: 'low' }, system: SYSTEM, messages })
    const text = messageText(msg)
    const v = validateSnippet(text)
    if (v.ok) return { ok: true, snippet: v.code }
    lastError = `${text}\n\nREJECTED:${v.error}`
  }
  return { ok: false, error: `The AI's element didn't pass the safety checks (${lastError.split('\n\nREJECTED:')[1] ?? 'invalid'}). Try describing it differently.` }
}

// ─── "Ask Quante" about a clicked element (2026-10-01) ───────────────────────
// The merchant clicks ANY element in the visual editor and writes what they want. Unlike
// the static snippets above, this is a real code edit (same model + system prompt as a
// chat edit): the model gets the element, its whole file and the store's data files and
// answers with either a replacement for just that element (fast) or complete files. The
// caller runs the result through the store-file safety filter and a compile check in the
// editing sandbox before anything is saved.

export interface ElementEditInput {
  instruction: string
  filePath: string
  fileSource: string
  elementSource: string
  startLine: number
  endLine: number
  /** Other files the model may rewrite (data/config.ts, data/products.ts …), by path. */
  context: Record<string, string>
  /** Every file of the built store (names only — not shown, never rewritten). */
  allPaths: string[]
}

export type ElementEditResult =
  | { ok: true; reply: string; element: string | null; files: Record<string, string> }
  | { ok: false; error: string }

const ELEMENT_EDIT_TIMEOUT_MS = 200_000

export async function editElementWithAi(opts: ElementEditInput): Promise<ElementEditResult> {
  const contextText = Object.entries(opts.context).map(([p, c]) => `=== ${p} ===\n${c}`).join('\n\n')
  const others = opts.allPaths.filter((p) => p !== opts.filePath && !(p in opts.context) && /^(app|components|data)\//.test(p))
  const user = [
    'VISUAL EDITOR — the merchant clicked ONE element in their store preview and typed an instruction for it.',
    '',
    `SELECTED ELEMENT (in ${opts.filePath}, lines ${opts.startLine}–${opts.endLine}):`,
    opts.elementSource,
    '',
    `FILE ${opts.filePath} (complete):`,
    opts.fileSource,
    '',
    contextText ? `DATA FILES (complete, editable):\n${contextText}\n` : '',
    `OTHER STORE FILES (exist, not shown — never rewrite them): ${others.join(', ')}`,
    '',
    "MERCHANT'S INSTRUCTION (about the selected element):",
    opts.instruction,
    '',
    'HOW TO ANSWER (overrides the output format above where it differs):',
    '- Change the SELECTED element as asked; leave everything else as it is unless the instruction needs it.',
    `- Fastest form — when the change fits inside the selected element and needs no new import: after <reply>, output <element>…</element> with the complete new JSX that replaces lines ${opts.startLine}–${opts.endLine} exactly (one root element, same place in the tree).`,
    `- If you need new imports, changes elsewhere in ${opts.filePath} or a new component: output the complete <file path="${opts.filePath}"> instead of <element>.`,
    '- Data changes (product names, prices, images, nav links, texts stored in data files) → output the complete data file as <file path="data/…">. It may be combined with <element>.',
    `- Write ONLY ${opts.filePath}, the data files shown above, or NEW files under components/store/. Never output a file you were not shown.`,
    '- Always start with <reply>…</reply> (1–2 sentences in the merchant\'s language). If the request is impossible here, explain it in <reply> and output nothing else.',
    '',
    AI_FILTER_PROMPT_NOTE,
  ].join('\n')

  const stream = anthropic.messages.stream({
    model: ITERATION_MODEL,
    max_tokens: 32000,
    system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_ITERATION, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  })
  const timer = setTimeout(() => stream.abort(), ELEMENT_EDIT_TIMEOUT_MS)
  let msg: Awaited<ReturnType<typeof stream.finalMessage>>
  try {
    msg = await stream.finalMessage()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, error: 'Quante took too long — try a smaller change.' }
    throw err
  } finally {
    clearTimeout(timer)
  }
  if ((msg.stop_reason as string) === 'refusal') return { ok: false, error: "Quante can't help with that request." }
  if (msg.stop_reason === 'max_tokens') return { ok: false, error: 'The change was too large for one step — try a smaller request.' }

  const raw = messageText(msg)
  const reply = raw.match(/<reply>([\s\S]*?)<\/reply>/)?.[1].trim() || 'Done.'
  const elementMatch = raw.match(/<element>\r?\n?([\s\S]*?)\r?\n?<\/element>/)
  const files: Record<string, string> = {}
  const fileRe = /<file path="([^"]+)">\r?\n?([\s\S]*?)\r?\n?<\/file>/g
  let m: RegExpExecArray | null
  while ((m = fileRe.exec(raw)) !== null) files[m[1].trim()] = m[2]
  const element = elementMatch && elementMatch[1].trim() ? elementMatch[1].trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '') : null
  return { ok: true, reply, element, files }
}
