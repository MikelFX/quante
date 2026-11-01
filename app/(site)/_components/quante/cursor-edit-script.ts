// The "your cursor edits this page" intro on /quante/qdit and /quante/qgent (CursorEdit.tsx).
// Pure data + helpers, no imports: the tests read it directly. Every draft is derived from the real
// copy in content/assetra/modules.ts, so the page always ends on the real headline and lead — the
// animation only shows how it got there.

export type CursorEditKind = 'qdit' | 'qgent'

/** Qdit: the headline starts with its last two letters swapped and the cursor fixes the typo;
 *  then it selects a phrase of the lead and gives it the accent colour. */
export interface QditScript {
  kind: 'qdit'
  /** the real headline, split around the two letters that get retyped */
  title: { keep: string; typo: string; fix: string }
  /** the real lead, split around the phrase that gets coloured */
  lead: { before: string; phrase: string; after: string }
}

/** Qgent: the lead starts shortened; Qgent proposes the rest, the cursor confirms, it types in. */
export interface QgentScript {
  kind: 'qgent'
  lead: { kept: string; draftEnd: string; added: string }
}

export type CursorEditScript = QditScript | QgentScript

/** Qdit: the phrase of the lead that gets the accent colour (must be in the lead). */
export const QDIT_PHRASE = 'přímo na stránce'
/** Qgent: where the shortened lead ends; everything from here on is Qgent's proposal. */
export const QGENT_CUT = ', navrhne'

export function qditScript(name: string, lead: string): QditScript | null {
  const at = lead.indexOf(QDIT_PHRASE)
  if (name.length < 3 || at < 0) return null
  const fix = name.slice(-2)
  if (fix[0] === fix[1]) return null
  return {
    kind: 'qdit',
    title: { keep: name.slice(0, -2), typo: fix[1] + fix[0], fix },
    lead: { before: lead.slice(0, at), phrase: QDIT_PHRASE, after: lead.slice(at + QDIT_PHRASE.length) },
  }
}

export function qgentScript(lead: string): QgentScript | null {
  const at = lead.indexOf(QGENT_CUT)
  if (at <= 0 || !lead.endsWith('.')) return null
  // The draft ends with a full stop where the proposal begins; the proposal replaces that stop.
  return { kind: 'qgent', lead: { kept: lead.slice(0, at), draftEnd: '.', added: lead.slice(at) } }
}

export function cursorEditScript(kind: string, name: string, lead: string): CursorEditScript | null {
  if (kind === 'qdit') return qditScript(name, lead)
  if (kind === 'qgent') return qgentScript(lead)
  return null
}

/** What the headline / lead read once the script has run — must equal the real copy. */
export function finalText(s: CursorEditScript): { title?: string; lead: string } {
  if (s.kind === 'qdit') return { title: s.title.keep + s.title.fix, lead: s.lead.before + s.lead.phrase + s.lead.after }
  return { lead: s.lead.kept + s.lead.added }
}

/** Points of a quadratic curve from a to b, bowed sideways by `bow` × distance — a hand's arc,
 *  not a straight line. t is eased per point so the keyframes can run linearly. */
export function arcPath(a: { x: number; y: number }, b: { x: number; y: number }, bow = 0.18, n = 14) {
  const dx = b.x - a.x, dy = b.y - a.y
  const c = { x: (a.x + b.x) / 2 - dy * bow, y: (a.y + b.y) / 2 + dx * bow }
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2 // easeInOutCubic
    pts.push({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
    })
  }
  return pts
}

/** Travel time for a move of `dist` px: short hops are quick, long ones don't drag. */
export function moveMs(dist: number) {
  return Math.round(Math.min(1050, Math.max(380, 300 + Math.sqrt(Math.max(0, dist)) * 26)))
}
