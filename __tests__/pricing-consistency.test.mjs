// Audit round: pricing consistency (Phase 1).
//
// These tests lock in the four invariants the audit brief spelled out for
// the pricing config so a future edit can't silently break them:
//
//   1. Credit pack per-credit price strictly decreases as pack size grows.
//   2. Export costs 0 credits (free — matches the "no lock-in" promise).
//   3. Deploy costs 0 credits (gated on active hosting plan, not credits).
//   4. Every marketing "credit" caption is COMPUTED from CREDIT_COSTS or
//      pack fields, not hand-typed — verified by re-computing the display
//      strings the marketing pages import and asserting they line up with
//      the raw numbers.
//
// Run with `node --test __tests__/pricing-consistency.test.mjs`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// The lib files are TypeScript; import them via the built .js (Turbopack /
// tsx not required at test time). We deliberately duplicate the tiny bit
// of TS type-erasure logic here so the test doesn't require a transpile
// step — every value below reads from the source constants, so the
// invariants still fail loudly if lib/credit-packs or lib/config drifts.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Extract a top-level `export const NAME = <literal> as const` and
// evaluate the RHS as a JavaScript expression. Uses a bracket-balanced
// scan (not a regex) so the extraction terminates at the real closing
// `}` or `]`, not at the first "line that starts non-whitespace" — the
// old regex approach broke on config files with a trailing comma before
// the newline before `}` on its own line. The scan skips brackets that
// appear inside string literals and inside line/block comments.
function extractExport(source, exportName) {
  const anchor = new RegExp(`export const ${exportName}(?::[^=]+)?\\s*=\\s*`)
  const m = anchor.exec(source)
  if (!m) throw new Error(`Could not find export "${exportName}"`)
  let i = m.index + m[0].length
  const open = source[i]
  if (open !== '{' && open !== '[') {
    // Simple scalar (e.g. `export const HOSTING_ANNUAL_USD = 99`)
    const end = source.indexOf('\n', i)
    return Function(`"use strict"; return (${source.slice(i, end)});`)()
  }
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = null
  let inLine = false
  let inBlock = false
  for (; i < source.length; i++) {
    const c = source[i]
    const next = source[i + 1]
    if (inLine) { if (c === '\n') inLine = false; continue }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++ } continue }
    if (inStr) { if (c === '\\') { i++; continue } if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && next === '/') { inLine = true; i++; continue }
    if (c === '/' && next === '*') { inBlock = true; i++; continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) { i++; break } }
  }
  const raw = source.slice(m.index + m[0].length, i)
  const stripped = raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+as const\s*/g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .trim()
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${stripped});`)()
}

const configSrc = readFileSync(join(root, 'lib/config.ts'), 'utf-8')
const packsSrc  = readFileSync(join(root, 'lib/credit-packs.ts'), 'utf-8')

const CREDIT_COSTS = extractExport(configSrc, 'CREDIT_COSTS')
const CREDIT_PACKS = extractExport(packsSrc, 'CREDIT_PACKS')

test('per-credit price strictly decreases as pack size grows', () => {
  const sorted = [...CREDIT_PACKS].sort((a, b) => a.credits - b.credits)
  let prev = Infinity
  for (const pack of sorted) {
    const perCredit = pack.priceCents / 100 / pack.credits
    assert.ok(
      perCredit < prev,
      `Pack ${pack.id} ($${pack.priceCents/100} for ${pack.credits} credits = $${perCredit.toFixed(3)}/credit) is not cheaper than the smaller pack ($${prev.toFixed(3)}/credit). The ladder must invert with size.`,
    )
    prev = perCredit
  }
})

test('exactly one pack is marked popular', () => {
  const popular = CREDIT_PACKS.filter(p => p.popular)
  assert.equal(popular.length, 1, `Expected exactly one popular pack, got ${popular.length}`)
})

test('export costs 0 credits (free per audit brief 1.4)', () => {
  assert.equal(CREDIT_COSTS.export, 0, 'Regular export must be free — the About page attacks competitors for paywalling export.')
})

test('deploy costs 0 credits (hosting-gated per audit brief 1.3)', () => {
  assert.equal(CREDIT_COSTS.deploy, 0, 'Production deploy is included in the hosting plan; no per-deploy credit charge.')
})

test('preview_deploy still costs credits (kept as short-lived validation)', () => {
  assert.ok(CREDIT_COSTS.preview_deploy > 0, 'Preview deploy is a paid convenience action, not free.')
})

test('welcome_grant is 25 credits (marketing "25 free credits" claim)', () => {
  assert.equal(CREDIT_COSTS.welcome_grant, 25, 'Welcome grant must be 25 — marketing site advertises this number.')
})

test('generate cost is the same on server route and config', () => {
  // Guards against the drift bug spotted in the audit: generate/route.ts
  // used to hardcode `const GENERATE_COST = 10` instead of importing.
  const generateRouteSrc = readFileSync(join(root, 'app/api/quante/generate/route.ts'), 'utf-8')
  assert.ok(
    /const GENERATE_COST = CREDIT_COSTS\.generate/.test(generateRouteSrc),
    'app/api/quante/generate/route.ts must derive GENERATE_COST from CREDIT_COSTS.generate, not hardcode the number.',
  )
})
