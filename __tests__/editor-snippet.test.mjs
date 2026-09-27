// Visual editor v2: snippet validation (lib/editor/snippet.ts) and insert / replace /
// delete ops (lib/editor/oid.ts).
// Usage: node --test __tests__/editor-snippet.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const S = await import(new URL('../lib/editor/snippet.ts', import.meta.url).href)
const E = await import(new URL('../lib/editor/oid.ts', import.meta.url).href)
const build = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)

const BUTTON = `<Link href="/collections/all" className="inline-flex items-center gap-2 bg-accent text-accent-text rounded-store px-6 py-3">
  Koupit <ArrowRight size={16} />
</Link>`

test('valid snippets: tags, Link, icons, string attributes, static text', () => {
  const r = S.validateSnippet(BUTTON)
  assert.ok(r.ok, r.error)
  assert.deepEqual(r.icons, ['ArrowRight'])
  assert.equal(r.usesLink, true)
  assert.ok(S.validateSnippet('<p className="text-muted">A < B {"& {C}"}</p>'.replace('A < B ', 'A ')).ok)
  assert.ok(S.validateSnippet('<img src="https://x.supabase.co/a.png" alt="Svíčka" className="w-full rounded-store" />').ok)
  assert.ok(S.validateSnippet('```tsx\n<hr className="border-border" />\n```').ok) // code fence stripped
})

test('unsafe or dynamic snippets are refused', () => {
  const bad = [
    '<button onClick={() => alert(1)}>x</button>',
    '<div dangerouslySetInnerHTML={{ __html: "<img onerror=x>" }} />',
    '<p>{product.name}</p>',
    '<p>{fetch("https://evil")}</p>',
    '<div {...props} />',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.com" />',
    '<a href="javascript:alert(1)">x</a>',
    '<img src="//evil.com/x.png" />',
    '<MyComponent />',
    '<p style={{ color: "red" }}>x</p>',
    '<p className={x}>x</p>',
    '<p className="a&quot;">x</p>'.replace('&quot;', '"'),
    'const x = 1',
    '',
    '<p>ok</p>; alert(1)',
  ]
  for (const b of bad) assert.equal(S.validateSnippet(b).ok, false, b)
})

const PAGE = `import { Star } from 'lucide-react'

export default function HomePage() {
  return (
    <main className="px-4">
      <h1 className="text-4xl">Svíčky</h1>
      <section className="py-8">
        <p>Text</p>
      </section>
      <p>{items.length} items</p>
    </main>
  )
}
`
const nodes = () => E.instrumentSource('components/store/HomePage.tsx', PAGE, '0').nodes
const idx = (tag, n = 0) => nodes().filter((x) => x.tag === tag)[n].index

test('node flags: static, canDelete, canInsertInside', () => {
  const by = nodes()
  assert.equal(by[0].tag, 'main')
  assert.equal(by[0].canDelete, false) // root of the component
  assert.equal(by[0].static, false) // contains {items.length}
  const h1 = by.find((n) => n.tag === 'h1')
  assert.equal(h1.static, true)
  assert.equal(h1.canDelete, true)
  assert.equal(h1.canInsertInside, true)
})

test('insert after: indented on its own line, imports added, new element selected', () => {
  const r = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'insert', position: 'after', snippet: BUTTON })
  assert.ok(r.ok, r.error)
  assert.match(r.code, /<h1 className="text-4xl">Svíčky<\/h1>\n      <Link href="\/collections\/all"/)
  assert.match(r.code, /\n        Koupit <ArrowRight size=\{16\} \/>\n      <\/Link>/)
  assert.match(r.code, /^import \{ Star, ArrowRight \} from 'lucide-react'\nimport Link from 'next\/link'/)
  const after = E.instrumentSource('x.tsx', r.code, '0').nodes
  assert.equal(after[r.index].tag, 'Link')
  assert.equal(build.rejectAiStoreFile('components/store/HomePage.tsx', r.code), null)
})

test('insert inside appends a last child; replace rewrites a static element; delete removes it', () => {
  const inside = E.applyEditorOp('x.tsx', PAGE, idx('section'), 'section', { kind: 'insert', position: 'inside', snippet: '<p className="text-muted">Nový</p>' })
  assert.ok(inside.ok, inside.error)
  assert.match(inside.code, /<p>Text<\/p>\n        <p className="text-muted">Nový<\/p>\n      <\/section>/)

  const rep = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'replace', snippet: '<h2 className="text-5xl font-heading">Nové</h2>' })
  assert.ok(rep.ok, rep.error)
  assert.match(rep.code, /<h2 className="text-5xl font-heading">Nové<\/h2>/)
  assert.doesNotMatch(rep.code, /<h1/)

  const dynamic = idx('p', 1)
  assert.equal(E.applyEditorOp('x.tsx', PAGE, dynamic, 'p', { kind: 'replace', snippet: '<p>x</p>' }).ok, false)

  const del = E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'delete' })
  assert.ok(del.ok)
  assert.doesNotMatch(del.code, /Svíčky/)
  assert.match(del.code, /<main className="px-4">\n      <section/)
  assert.equal(E.applyEditorOp('x.tsx', PAGE, 0, 'main', { kind: 'delete' }).ok, false)
})

test('insert refuses unsafe snippets and void targets', () => {
  assert.equal(E.applyEditorOp('x.tsx', PAGE, idx('h1'), 'h1', { kind: 'insert', position: 'after', snippet: '<button onClick={x}>x</button>' }).ok, false)
  const withImg = PAGE.replace('<p>Text</p>', '<img src="/a.png" alt="" />')
  const img = E.instrumentSource('x.tsx', withImg, '0').nodes.find((n) => n.tag === 'img')
  assert.equal(img.canInsertInside, false)
  assert.equal(E.applyEditorOp('x.tsx', withImg, img.index, 'img', { kind: 'insert', position: 'inside', snippet: '<p>x</p>' }).ok, false)
})
