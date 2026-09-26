// Visual editor v1 core (lib/editor/oid.ts): data-oid instrumentation of the sandbox copy
// and text / classes / move edits applied to the clean source.
// Usage: node --test __tests__/editor-oid.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const E = await import(new URL('../lib/editor/oid.ts', import.meta.url).href)

const PAGE = `import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

export default function HomePage() {
  const items = ['a', 'b']
  return (
    <main className="px-4">
      <h1 className="text-4xl font-heading">Svíčky pro večery</h1>
      <p>
        Ručně lité v Praze
      </p>
      <motion.div className="grid">
        {items.map((i) => (
          <span key={i} className="text-muted">{i}</span>
        ))}
      </motion.div>
      <Link href="/collections/all" className={\`btn \${x}\`}>Shop</Link>
      <svg viewBox="0 0 10 10"><path d="M0 0" /></svg>
      <Star size={12} />
      <button>{"Buy"}</button>
    </main>
  )
}
`

test('editable paths: store pages yes, engine / legal / layout no', () => {
  assert.equal(E.isEditorEditablePath('components/store/HomePage.tsx'), true)
  assert.equal(E.isEditorEditablePath('app/page.tsx'), true)
  assert.equal(E.isEditorEditablePath('app/products/[slug]/page.tsx'), true)
  assert.equal(E.isEditorEditablePath('components/layout/Navbar.tsx'), true)
  for (const p of ['app/cart/page.tsx', 'app/success/page.tsx', 'app/layout.tsx', 'app/terms/page.tsx', 'components/layout/CartDrawer.tsx', 'data/config.ts', 'app/api/x/route.ts', 'components/store/x.ts']) {
    assert.equal(E.isEditorEditablePath(p), false, p)
  }
})

test('instrumentSource tags HTML elements, motion.* and Link — not custom components or svg children', () => {
  const { code, nodes } = E.instrumentSource('components/store/HomePage.tsx', PAGE, '3')
  assert.deepEqual(nodes.map((n) => n.tag), ['main', 'h1', 'p', 'motion.div', 'span', 'Link', 'svg', 'button'])
  assert.match(code, /<main data-oid="3\.0" className="px-4">/)
  assert.match(code, /<h1 data-oid="3\.1" className/)
  assert.match(code, /<motion\.div data-oid="3\.3"/)
  assert.match(code, /<path d="M0 0" \/>/) // svg children untouched
  assert.doesNotMatch(code, /<Star data-oid/)
  // Everything except the inserted attributes is unchanged.
  assert.equal(code.replace(/ data-oid="[^"]*"/g, ''), PAGE)
})

test('node metadata: text, classes, move options, repeated', () => {
  const { nodes } = E.instrumentSource('x.tsx', PAGE, '0')
  const by = Object.fromEntries(nodes.map((n) => [n.tag, n]))
  assert.equal(by.h1.text, 'Svíčky pro večery')
  assert.equal(by.h1.className, 'text-4xl font-heading')
  assert.equal(by.p.text, 'Ručně lité v Praze')
  assert.equal(by.p.className, '')
  assert.equal(by.button.text, 'Buy')
  assert.equal(by.main.text, null)
  assert.equal(by.Link.className, null) // template literal with ${} → not editable
  assert.equal(by.span.repeated, true)
  assert.equal(by.h1.repeated, false)
  assert.equal(by.h1.canMoveUp, false)
  assert.equal(by.h1.canMoveDown, true)
  assert.equal(by.button.canMoveDown, false)
})

test('text edit keeps surrounding whitespace; special characters become a string expression', () => {
  const idx = (tag) => E.instrumentSource('x.tsx', PAGE, '0').nodes.findIndex((n) => n.tag === tag)
  const r = E.applyEditorOp('x.tsx', PAGE, idx('p'), 'p', { kind: 'text', value: 'Nový text' })
  assert.ok(r.ok)
  assert.match(r.code, /<p>\n        Nový text\n      <\/p>/)
  const r2 = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'text', value: 'A < B & {C}' })
  assert.ok(r2.ok)
  assert.match(r2.code, /<h1 className="text-4xl font-heading">\{"A < B & \{C\}"\}<\/h1>/)
  const r3 = E.applyEditorOp('x.tsx', PAGE, idx('button'), 'button', { kind: 'text', value: 'Koupit' })
  assert.match(r3.code, /<button>Koupit<\/button>/)
  const bad = E.applyEditorOp('x.tsx', PAGE, idx('main'), 'main', { kind: 'text', value: 'x' })
  assert.equal(bad.ok, false)
})

test('class edit: replace, add, remove; unsafe values and dynamic classNames refused', () => {
  const nodes = E.instrumentSource('x.tsx', PAGE, '0').nodes
  const idx = (tag) => nodes.findIndex((n) => n.tag === tag)
  const r = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'classes', value: 'text-5xl  font-heading text-accent' })
  assert.match(r.code, /<h1 className="text-5xl font-heading text-accent">/)
  const add = E.applyEditorOp('x.tsx', PAGE, idx('p'), 'p', { kind: 'classes', value: 'text-muted bg-[#fff]' })
  assert.match(add.code, /<p className="text-muted bg-\[#fff\]">/)
  const rm = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'classes', value: '' })
  assert.match(rm.code, /<h1>Svíčky pro večery<\/h1>/)
  assert.equal(E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'classes', value: 'a" onClick={x}' }).ok, false)
  assert.equal(E.applyEditorOp('x.tsx', PAGE, idx('Link'), 'Link', { kind: 'classes', value: 'x' }).ok, false)
})

test('move swaps adjacent sibling elements and reports the new index', () => {
  const nodes = E.instrumentSource('x.tsx', PAGE, '0').nodes
  const h1 = nodes.findIndex((n) => n.tag === 'h1')
  const r = E.applyEditorOp('x.tsx', PAGE, h1, 'h1', { kind: 'move', direction: 'down' })
  assert.ok(r.ok)
  assert.ok(r.code.indexOf('<p>') < r.code.indexOf('<h1'))
  const after = E.instrumentSource('x.tsx', r.code, '0').nodes
  assert.equal(after[r.index].tag, 'h1')
  const back = E.applyEditorOp('x.tsx', r.code, r.index, 'h1', { kind: 'move', direction: 'up' })
  assert.equal(back.code, PAGE)
  assert.equal(E.applyEditorOp('x.tsx', PAGE, h1, 'h1', { kind: 'move', direction: 'up' }).ok, false)
})

test('a stale map (tag mismatch) is refused', () => {
  const r = E.applyEditorOp('x.tsx', PAGE, 1, 'p', { kind: 'text', value: 'x' })
  assert.equal(r.ok, false)
})

test('instrumentFiles keys files deterministically and skips non-editable files', () => {
  const files = { 'components/store/HomePage.tsx': PAGE, 'app/cart/page.tsx': '<div/>', 'data/config.ts': 'x', 'app/page.tsx': 'export default function P(){return <div>x</div>}' }
  const r = E.instrumentFiles(files)
  assert.deepEqual(Object.keys(r.files).sort(), ['app/page.tsx', 'components/store/HomePage.tsx'])
  assert.ok(r.nodes['0.0']) // app/page.tsx sorts first
  assert.equal(r.nodes['1.1'].tag, 'h1')
})
