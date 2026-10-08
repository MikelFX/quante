// Qgent in the Studio (shop mode): pure functions only — the routes under
// app/api/projects/[id]/qgent do the I/O. Tested in __tests__/qgent-shop.test.mjs.
//
// A review returns findings; each finding may carry small find/replace edits on existing store
// files. Nothing is applied here: applyEdits() computes the new files, editHunks() the diff the
// merchant sees, sensitiveReasons() whether the change touches prices, currency or the checkout
// flow (those need a second, separate confirmation). The merchant confirms, the route saves a
// DRAFT code version and logs it; revertFiles() undoes exactly what an action changed.

export const SHOP_LIMITS = {
  findings: 8,
  editsPerFinding: 6,
  findChars: 4000,
  replaceChars: 12000,
  titleChars: 120,
  textChars: 600,
  /** Characters of one file shown to the model in a review; longer files are cut. */
  fileCharsInPrompt: 24000,
  /** Total characters of store files in one review prompt. */
  promptChars: 260000,
} as const

export type Severity = 'high' | 'medium' | 'low'

export interface ShopEdit {
  path: string
  find: string
  replace: string
}

export interface ShopFinding {
  title: string
  why: string
  area: string
  severity: Severity
  edits: ShopEdit[]
}

export interface AdsBrief {
  brand: string
  audience: string
  tone: string
  products: Array<{ name: string; description: string }>
}

export interface ReviewOutput {
  summary: string
  findings: ShopFinding[]
  adsBrief: AdsBrief | null
}

/** JSON schema for the review (structured output). Kept flat and closed. */
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'adsBrief'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'why', 'area', 'severity', 'edits'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          area: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'find', 'replace'],
              properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } },
            },
          },
        },
      },
    },
    adsBrief: {
      type: 'object',
      additionalProperties: false,
      required: ['brand', 'audience', 'tone', 'products'],
      properties: {
        brand: { type: 'string' },
        audience: { type: 'string' },
        tone: { type: 'string' },
        products: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'description'],
            properties: { name: { type: 'string' }, description: { type: 'string' } },
          },
        },
      },
    },
  },
} as const

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * Cleans the model's review: caps counts and lengths, drops malformed findings and edits on
 * files that don't exist or may not be edited (`canEdit`). A finding without edits stays —
 * it is advice the merchant handles by hand.
 */
export function normalizeReview(raw: unknown, canEdit: (path: string) => boolean): ReviewOutput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const findings: ShopFinding[] = []
  for (const f of Array.isArray(r.findings) ? r.findings : []) {
    if (findings.length >= SHOP_LIMITS.findings) break
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    const title = line(o.title, SHOP_LIMITS.titleChars)
    if (!title) continue
    const severity: Severity = o.severity === 'high' || o.severity === 'low' ? o.severity : 'medium'
    const edits: ShopEdit[] = []
    for (const e of Array.isArray(o.edits) ? o.edits : []) {
      if (edits.length >= SHOP_LIMITS.editsPerFinding) break
      if (!e || typeof e !== 'object') continue
      const { path, find, replace } = e as Record<string, unknown>
      if (typeof path !== 'string' || typeof find !== 'string' || typeof replace !== 'string') continue
      if (!find || find === replace || find.length > SHOP_LIMITS.findChars || replace.length > SHOP_LIMITS.replaceChars) continue
      if (!canEdit(path)) continue
      edits.push({ path, find, replace })
    }
    findings.push({ title, why: line(o.why, SHOP_LIMITS.textChars), area: line(o.area, 80), severity, edits })
  }
  let adsBrief: AdsBrief | null = null
  if (r.adsBrief && typeof r.adsBrief === 'object') {
    const a = r.adsBrief as Record<string, unknown>
    const products = (Array.isArray(a.products) ? a.products : [])
      .slice(0, 12)
      .map((p) => ({ name: line((p as Record<string, unknown>)?.name, 120), description: line((p as Record<string, unknown>)?.description, 400) }))
      .filter((p) => p.name)
    adsBrief = { brand: line(a.brand, 120), audience: line(a.audience, 300), tone: line(a.tone, 200), products }
    if (!adsBrief.brand && !products.length) adsBrief = null
  }
  return { summary: line(r.summary, 800), findings, adsBrief }
}

export type ApplyResult =
  | { ok: true; before: Record<string, string>; after: Record<string, string> }
  | { ok: false; error: string; path?: string }

/**
 * Applies find/replace edits to the given files. Each `find` must occur exactly once in the
 * file as it is at that point (edits on one file run in order), so a stale or ambiguous edit
 * never lands in the wrong place.
 */
export function applyEdits(files: Record<string, string>, edits: ShopEdit[]): ApplyResult {
  const before: Record<string, string> = {}
  const after: Record<string, string> = {}
  for (const e of edits) {
    const current = e.path in after ? after[e.path] : files[e.path]
    if (typeof current !== 'string') return { ok: false, error: `${e.path} is not in the store.`, path: e.path }
    const at = current.indexOf(e.find)
    if (at < 0) return { ok: false, error: `The text to change in ${e.path} no longer matches the current version.`, path: e.path }
    if (current.indexOf(e.find, at + 1) >= 0) return { ok: false, error: `The text to change in ${e.path} is not unique.`, path: e.path }
    if (!(e.path in before)) before[e.path] = current
    after[e.path] = current.slice(0, at) + e.replace + current.slice(at + e.find.length)
  }
  for (const p of Object.keys(after)) {
    if (after[p] === before[p]) {
      delete after[p]
      delete before[p]
    }
  }
  if (!Object.keys(after).length) return { ok: false, error: 'The change would not change anything.' }
  return { ok: true, before, after }
}

/**
 * Undo of one applied action: the touched files go back to their old content, but only when
 * nobody changed them since (current === what the action wrote). Otherwise the merchant uses
 * the version history, so a later edit is never silently thrown away.
 */
export function revertFiles(
  current: Record<string, string>,
  before: Record<string, string>,
  after: Record<string, string>,
): { ok: true; files: Record<string, string> } | { ok: false; error: string; path: string } {
  const files: Record<string, string> = {}
  for (const [p, wrote] of Object.entries(after)) {
    if (current[p] !== wrote) return { ok: false, error: `${p} has changed since.`, path: p }
    if (typeof before[p] !== 'string') return { ok: false, error: `The original content of ${p} is missing.`, path: p }
    files[p] = before[p]
  }
  return { ok: true, files }
}

// ── diff ─────────────────────────────────────────────────────────────────

export interface DiffLine {
  t: ' ' | '-' | '+'
  text: string
}
export interface DiffHunk {
  path: string
  /** 1-based line where the hunk starts in the old file. */
  line: number
  lines: DiffLine[]
}

const CONTEXT = 2

/** The diff the merchant confirms: one hunk per edit with two lines of context. */
export function editHunks(files: Record<string, string>, edits: ShopEdit[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const work: Record<string, string> = {}
  for (const e of edits) {
    const text = e.path in work ? work[e.path] : files[e.path]
    if (typeof text !== 'string') continue
    const at = text.indexOf(e.find)
    if (at < 0) continue
    const startLine = text.slice(0, at).split('\n').length - 1
    const all = text.split('\n')
    const findLines = e.find.split('\n')
    const endLine = startLine + findLines.length - 1
    // Whole lines around the match, so a change inside a line still reads naturally.
    const oldBlock = all.slice(startLine, endLine + 1).join('\n')
    const colStart = at - text.slice(0, at).lastIndexOf('\n') - 1
    const newBlock = oldBlock.slice(0, colStart) + e.replace + oldBlock.slice(colStart + e.find.length)
    const lines: DiffLine[] = []
    for (const l of all.slice(Math.max(0, startLine - CONTEXT), startLine)) lines.push({ t: ' ', text: l })
    for (const l of oldBlock.split('\n')) lines.push({ t: '-', text: l })
    for (const l of newBlock.split('\n')) lines.push({ t: '+', text: l })
    for (const l of all.slice(endLine + 1, endLine + 1 + CONTEXT)) lines.push({ t: ' ', text: l })
    hunks.push({ path: e.path, line: Math.max(1, startLine + 1 - CONTEXT), lines })
    work[e.path] = text.slice(0, at) + e.replace + text.slice(at + e.find.length)
  }
  return hunks
}

// ── sensitive changes ────────────────────────────────────────────────────

/** Files of the order flow: a change there can break or alter how customers pay. */
export const CHECKOUT_FILES = new Set(['app/cart/page.tsx', 'components/layout/CartDrawer.tsx', 'app/success/page.tsx'])

const PRICE_RE = /\b(price|compareAtPrice)\s*:\s*(-?[\d_.]+)/g
const CURRENCY_RE = /\bcurrency\s*:\s*['"`]([^'"`]*)['"`]/g
const MONEY_WORDS =
  /(doprav\w*|poštovn\w*|postovn\w*|shipping|delivery|platb\w*|zaplat\w*|payment\w*|dobírk\w*|dobirk\w*|zásilkovn\w*|zasilkovn\w*|\bppl\b|\bgls\b|\bdhl\b|comgate|gopay|paypal|stripe|checkout|pokladn\w*|refund\w*|vrácení peněz|vraceni penez|slev\w*|discount\w*|\bdph\b|\bvat\b|zdarma|\bfree\b)/gi
const AMOUNT_RE = /(\d[\d\s.,]*\s?(kč|czk|eur|€|usd|\$|zł|pln)|(€|\$)\s?\d[\d\s.,]*)/gi

function values(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => `${m[1]}=${m[2] ?? m[1]}`)
}

/** Money words and amounts in some lines, normalised, so a re-linked or moved line compares equal. */
function moneyTokens(lines: string[], re: RegExp): string {
  return lines
    .flatMap((l) => [...l.matchAll(re)].map((m) => m[0].toLowerCase().replace(/\s+/g, '')))
    .sort()
    .join('|')
}

/**
 * Why a change counts as money-related (prices, currency, checkout, shipping or payment
 * wording). Decided here, never by the model. Empty = an ordinary change.
 */
export function sensitiveReasons(before: Record<string, string>, after: Record<string, string>): string[] {
  const reasons = new Set<string>()
  for (const path of Object.keys(after)) {
    const a = before[path] ?? ''
    const b = after[path]
    if (values(PRICE_RE, a).join('|') !== values(PRICE_RE, b).join('|')) reasons.add('changes product prices')
    if (values(CURRENCY_RE, a).join('|') !== values(CURRENCY_RE, b).join('|')) reasons.add('changes the store currency')
    if (CHECKOUT_FILES.has(path)) reasons.add('changes the cart or order completion')
    // Only what changed counts: removed vs added lines. Re-linking a "Doprava a platba" menu item
    // keeps the same words and amounts; "od 1500 Kč" → "od 990 Kč" does not.
    const oldLines = new Set(a.split('\n'))
    const newLines = new Set(b.split('\n'))
    const added = b.split('\n').filter((l) => !oldLines.has(l))
    const removed = a.split('\n').filter((l) => !newLines.has(l))
    if (moneyTokens(added, MONEY_WORDS) !== moneyTokens(removed, MONEY_WORDS)) reasons.add('changes text about shipping, payments or prices')
    if (moneyTokens(added, AMOUNT_RE) !== moneyTokens(removed, AMOUNT_RE)) reasons.add('changes amounts in the text')
  }
  return [...reasons]
}
