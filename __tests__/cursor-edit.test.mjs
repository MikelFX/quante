// The cursor that edits the hero of /quante/qdit and /quante/qgent (CursorEdit.tsx +
// cursor-edit-script.ts + cursor-edit.css): it always ends on the real copy, the real copy is in the
// DOM for everyone, and it is scoped and cheap like the rest of the design system.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const S = await import('../app/(site)/_components/quante/cursor-edit-script.ts')
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const modules = read('../content/assetra/modules.ts')
const css = read('../app/(site)/cursor-edit.css').replace(/\/\*[\s\S]*?\*\//g, '')
const tsx = read('../app/(site)/_components/quante/CursorEdit.tsx')
const page = read('../app/(site)/_components/quante/ModulePage.tsx')

function copy(slug) {
  const block = modules.slice(modules.indexOf(`slug: '${slug}'`))
  return { name: block.match(/name: '([^']+)'/)[1], lead: block.match(/lead: '([^']+)'/)[1] }
}

for (const slug of ['qdit', 'qgent']) {
  test(`${slug}: the script exists and ends on the real headline and lead`, () => {
    const { name, lead } = copy(slug)
    const s = S.cursorEditScript(slug, name, lead)
    assert.ok(s, 'script missing — the copy no longer contains the edited phrase')
    const fin = S.finalText(s)
    assert.equal(fin.lead, lead)
    if (fin.title !== undefined) assert.equal(fin.title, name)
  })
}

test('qdit starts with a real typo and qgent with a shorter lead', () => {
  const q = copy('qdit'), g = copy('qgent')
  const d = S.qditScript(q.name, q.lead)
  assert.notEqual(d.title.keep + d.title.typo, q.name)
  const a = S.qgentScript(g.lead)
  assert.ok((a.lead.kept + a.lead.draftEnd).length < g.lead.length)
})

test('other modules keep their plain hero', () => {
  for (const slug of ['generate', 'qads', 'qscan', 'qails']) assert.equal(S.cursorEditScript(slug, 'X', 'Y z.'), null)
  assert.match(page, /cursorEditScript\(m\.slug/)
})

test('the cursor path starts and ends where asked and stays smooth', () => {
  const pts = S.arcPath({ x: 0, y: 0 }, { x: 300, y: 100 })
  assert.deepEqual(pts[0], { x: 0, y: 0 })
  assert.ok(Math.abs(pts.at(-1).x - 300) < 1e-9 && Math.abs(pts.at(-1).y - 100) < 1e-9)
  for (const d of [0, 20, 400, 5000]) { const ms = S.moveMs(d); assert.ok(ms >= 380 && ms <= 1050) }
})

test('real copy is always in the DOM; drafts are drawn by CSS, not page text', () => {
  assert.match(tsx, /className="ce-f"/)
  assert.match(css, /\.ce-a \[data-t\]::before\{content:attr\(data-t\)\}/)
  // without JS the real copy shows, with reduced motion / animations off too
  assert.match(css, /\[data-js\] \.ad \.ce\[data-run\] \.ce-a\{display:inline\}/)
  assert.match(css, /prefers-reduced-motion:reduce/)
  assert.match(css, /\[data-motion="off"\] \.ad \.ce \.ce-f/)
})

test('styles are scoped under .ad, keyframes prefixed ad-, colours from the design variables', () => {
  const rules = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '').replace(/@media[^{]*\{/g, '')
  for (const m of rules.matchAll(/(^|[{}])\s*([^{}@]+?)\s*\{/g)) {
    for (const s of m[2].split(',').map((x) => x.trim())) assert.match(s, /^(\[data-(js|motion="off")\] )?\.ad /, s)
  }
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) assert.ok(m[1].startsWith('ad-ce-'), m[1])
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i)
})

test('script animations only move transform and opacity', () => {
  const kf = [...tsx.matchAll(/\[\{ ?(\w+):/g)].map((m) => m[1])
  assert.ok(kf.length > 0)
  for (const k of kf) assert.ok(['opacity', 'transform'].includes(k), k)
})
