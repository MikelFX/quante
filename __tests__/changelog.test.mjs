// Changelog logic tests — plain node:test, no dev deps.
// Usage: node --test __tests__/changelog.test.mjs
//
// The tested logic is inlined from source (same pattern as export-whitelabel.test.mjs)
// and MUST be kept in sync with:
//   - app/api/admin/changelog/route.ts  (validate)
//   - app/(marketing)/changelog/page.tsx (groupByMonth, fallback branch)
//   - lib/changelog.ts (CHANGELOG_TAGS, slugify)

import { test } from 'node:test'
import assert from 'node:assert/strict'

const CHANGELOG_TAGS = ['feature','bugfix','platform','ai','design','domains','reliability']

function slugify(title) {
  return title.toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function validate(body, requireAll) {
  const date = typeof body.date === 'string' ? body.date : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const rawTags = Array.isArray(body.tags) ? body.tags : []

  if (requireAll || date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' }
    const [y, m, d] = date.split('-').map(Number)
    const parsed = new Date(Date.UTC(y, m - 1, d))
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
      return { error: 'date is not a real calendar date' }
    }
  }
  if ((requireAll || 'title' in body) && !title) return { error: 'title is required' }
  if ((requireAll || 'description' in body) && !description) return { error: 'description is required' }

  const normalizedTags = []
  for (const t of rawTags) {
    if (typeof t !== 'string') continue
    const lower = t.trim().toLowerCase()
    if (!lower) continue
    if (!CHANGELOG_TAGS.includes(lower)) return { error: `unknown tag "${lower}"` }
    if (!normalizedTags.includes(lower)) normalizedTags.push(lower)
  }
  return { date, title, description, tags: normalizedTags, slug: title ? slugify(title) : '' }
}

// Mirror of page.tsx groupByMonth
function groupByMonth(items) {
  const groups = {}
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date))
  for (const item of sorted) {
    const [year, month] = item.date.split('-')
    const key = `${year}-${month}`
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

// Mirror of page.tsx fallback decision
function pickEntries({ error, data }, fallback) {
  if (error) return { entries: fallback, queryFailed: true }
  if (!data || data.length === 0) return { entries: fallback, queryFailed: false }
  return { entries: data, queryFailed: false }
}

// ─── validate ──────────────────────────────────────────────────────────────

test('validate: happy path', () => {
  const v = validate({ date: '2026-08-03', title: '  Hi  ', description: 'body', tags: ['feature','bugfix'] }, true)
  assert.equal(v.error, undefined)
  assert.equal(v.title, 'Hi')
  assert.deepEqual(v.tags, ['feature','bugfix'])
  assert.equal(v.slug, 'hi')
})

test('validate: unknown tag → error 400', () => {
  const v = validate({ date: '2026-08-03', title: 'x', description: 'y', tags: ['nonsense'] }, true)
  assert.match(v.error ?? '', /unknown tag/)
})

test('validate: garbage date shape → error', () => {
  const v = validate({ date: 'yesterday', title: 'x', description: 'y', tags: [] }, true)
  assert.match(v.error ?? '', /YYYY-MM-DD/)
})

test('validate: impossible date (2026-02-30) → error', () => {
  const v = validate({ date: '2026-02-30', title: 'x', description: 'y', tags: [] }, true)
  assert.match(v.error ?? '', /real calendar date/)
})

test('validate: missing title → error', () => {
  const v = validate({ date: '2026-08-03', title: '   ', description: 'y', tags: [] }, true)
  assert.match(v.error ?? '', /title/)
})

test('validate: dedupes and lowercases tags', () => {
  const v = validate({ date: '2026-08-03', title: 't', description: 'd', tags: ['Feature','feature','BUGFIX'] }, true)
  assert.deepEqual(v.tags, ['feature','bugfix'])
})

test('validate: mixed valid + invalid tag rejects', () => {
  const v = validate({ date: '2026-08-03', title: 't', description: 'd', tags: ['feature','totally-fake'] }, true)
  assert.match(v.error ?? '', /unknown tag/)
})

// ─── slugify ───────────────────────────────────────────────────────────────

test('slugify: strips diacritics and non-ascii', () => {
  assert.equal(slugify('Maison Sève — Launch'), 'maison-seve-launch')
})

test('slugify: caps at 80 chars', () => {
  const long = 'a'.repeat(200)
  assert.equal(slugify(long).length, 80)
})

// ─── groupByMonth ──────────────────────────────────────────────────────────

test('groupByMonth: groups by YYYY-MM, sorted desc across year boundary', () => {
  const entries = [
    { date: '2025-12-30', title: 'a' },
    { date: '2026-01-05', title: 'b' },
    { date: '2025-12-31', title: 'c' },
    { date: '2026-01-01', title: 'd' },
  ]
  const groups = groupByMonth(entries)
  const keys = Object.keys(groups)
  assert.deepEqual(keys, ['2026-01', '2025-12'])
  assert.deepEqual(groups['2026-01'].map(e => e.title), ['b', 'd'])
  assert.deepEqual(groups['2025-12'].map(e => e.title), ['c', 'a'])
})

test('groupByMonth: empty input → empty groups', () => {
  assert.deepEqual(groupByMonth([]), {})
})

// ─── fallback decision ─────────────────────────────────────────────────────

const FB = [{ date: '2000-01-01', title: 'FB', description: 'x', tags: [] }]

test('fallback: query error → use fallback + queryFailed=true', () => {
  const r = pickEntries({ error: { message: 'boom' }, data: null }, FB)
  assert.equal(r.entries, FB)
  assert.equal(r.queryFailed, true)
})

test('fallback: empty success → use fallback + queryFailed=false', () => {
  const r = pickEntries({ error: null, data: [] }, FB)
  assert.equal(r.entries, FB)
  assert.equal(r.queryFailed, false)
})

test('fallback: real data → use data, ignore fallback', () => {
  const data = [{ date: '2026-08-03', title: 'live', description: 'ok', tags: [] }]
  const r = pickEntries({ error: null, data }, FB)
  assert.equal(r.entries, data)
  assert.equal(r.queryFailed, false)
})
