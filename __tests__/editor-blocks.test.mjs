// Visual editor v3 "My elements": what saving a selected element stores (the path of
// lib/editor/blocks.ts saveBlock — elementSource → validateSnippet → dedent) and that the
// stored snippet inserts back cleanly.
// Usage: node --test __tests__/editor-blocks.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = await import(new URL('../lib/editor/snippet.ts', import.meta.url).href)
const E = await import(new URL('../lib/editor/oid.ts', import.meta.url).href)

const PAGE = `import Link from 'next/link'
import { products } from '@/data/products'

export default function HomePage() {
  return (
    <main>
      <section className="py-16 bg-surface">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-3xl">Svíčky pro pomalé večery</h2>
          <Link href="/collections/all" className="bg-accent text-accent-text rounded-store px-6 py-3">Nakupovat</Link>
        </div>
      </section>
      <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
    </main>
  )
}
`
const PATH = 'components/store/HomePage.tsx'

function nodeByTag(tag) {
  const { nodes } = E.instrumentSource(PATH, PAGE, 'k')
  return nodes.find((n) => n.tag === tag)
}

function saved(tag) {
  const n = nodeByTag(tag)
  const src = E.elementSource(PATH, PAGE, n.index)
  const v = S.validateSnippet(src)
  return v.ok ? { ok: true, snippet: S.indentSnippet(v.code, '') } : v
}

test('a plain section saves, dedented, and inserts back as valid code', () => {
  const r = saved('section')
  assert.ok(r.ok, r.error)
  assert.match(r.snippet, /^<section className="py-16 bg-surface">\n  <div/)
  assert.match(r.snippet, /\n<\/section>$/)
  const h2 = nodeByTag('h2')
  const out = E.applyEditorOp(PATH, PAGE, h2.index, 'h2', { kind: 'insert', position: 'after', snippet: r.snippet })
  assert.ok(out.ok, out.error)
  assert.equal((out.code.match(/<section /g) ?? []).length, 2)
})

test('elements with live data or code cannot be saved', () => {
  assert.equal(saved('ul').ok, false)   // products.map
  assert.equal(saved('main').ok, false) // contains the list
})
