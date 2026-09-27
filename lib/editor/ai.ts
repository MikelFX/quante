// Visual editor v2 — "Create with AI" (2026-09-27). Server-only.
// The model writes ONE static JSX snippet for the selected spot; it is validated by the
// same rules as the ready-made blocks (lib/editor/snippet.ts) and, when it fails, gets
// one retry with the validation error. The caller applies it through applyEditorOp, so
// the result also passes the AI store-file filter before it is saved.

import { anthropic, ITERATION_MODEL } from '@/lib/claude'
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
    const msg = await anthropic.messages.create({ model: ITERATION_MODEL, max_tokens: 2500, system: SYSTEM, messages })
    const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim()
    const v = validateSnippet(text)
    if (v.ok) return { ok: true, snippet: v.code }
    lastError = `${text}\n\nREJECTED:${v.error}`
  }
  return { ok: false, error: `The AI's element didn't pass the safety checks (${lastError.split('\n\nREJECTED:')[1] ?? 'invalid'}). Try describing it differently.` }
}
