// Inline theme styles → Tailwind token classes (lib/store-template/style-codemod.ts) and
// the @theme tokens injected into styles/store.css at build time (withThemeTokens).
// Usage: node --test __tests__/style-codemod.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const cm = await import(new URL('../lib/store-template/style-codemod.ts', import.meta.url).href)
const build = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)

const conv = (src) => cm.convertInlineStyles(src, 'Page.tsx')

test('token styles become classes; the style attribute disappears when nothing is left', () => {
  const r = conv(`export default function P() {
  return <p className="mb-6 text-lg" style={{ color: 'var(--color-muted)' }}>Hi</p>
}
`)
  assert.equal(r.code, `export default function P() {
  return <p className="mb-6 text-lg text-muted">Hi</p>
}
`)
  assert.equal(r.converted, 1)
  assert.equal(r.remainingStyleAttrs, 0)
})

test('every mapped property', () => {
  const r = conv(`const a = <div style={{ background: 'var(--color-surface)', backgroundColor: "var(--color-accent)", borderColor: 'var(--color-border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-heading)', border: '1px solid var(--color-border)', borderTop: '1px solid var(--color-accent)', fill: 'var(--color-text)' }} />`)
  assert.match(r.code, /className="bg-surface bg-accent border-border rounded-store font-heading border border-border border-t border-t-accent fill-text"/)
  assert.doesNotMatch(r.code, /style=/)
  const f = conv(`const a = <i style={{ borderRadius: '50%', fontFamily: 'var(--font-body)' }} />`)
  assert.match(f.code, /className="rounded-full font-body"/)
})

test('non-token values stay inline, next to the new classes', () => {
  const r = conv(`const a = <div className="p-4" style={{ color: 'var(--color-accent)', width: \`\${pct}%\`, background: open ? 'var(--color-bg)' : 'var(--color-surface)' }} />`)
  assert.match(r.code, /className="p-4 text-accent"/)
  assert.match(r.code, /style=\{\{ width: `\$\{pct\}%`, background: open \? 'var\(--color-bg\)' : 'var\(--color-surface\)' \}\}/)
  assert.equal(r.converted, 1)
  assert.equal(r.remainingStyleAttrs, 1)
})

test('unknown tokens and near misses are not converted', () => {
  for (const src of [
    `const a = <p style={{ color: 'var(--color-rose)' }} />`,
    `const a = <p style={{ color: 'var(--color-accent, red)' }} />`,
    `const a = <p style={{ border: '2px solid var(--color-accent)' }} />`,
    `const a = <p style={{ borderRadius: '12px' }} />`,
    `const a = <p style={s} />`,
  ]) {
    assert.equal(conv(src).code, src)
  }
})

test('className forms: none, {"…"}, template literal; complex expressions are left alone', () => {
  assert.match(conv(`const a = <p style={{ color: 'var(--color-text)' }} />`).code, /<p className="text-text" \/>/)
  assert.match(conv(`const a = <p className={'x'} style={{ color: 'var(--color-text)' }} />`).code, /<p className="x text-text" \/>/)
  assert.match(conv('const a = <p className={`x ${y}`} style={{ color: \'var(--color-text)\' }} />').code, /className=\{`x \$\{y\} text-text`\}/)
  const cn = `const a = <p className={cn('x', y)} style={{ color: 'var(--color-text)' }} />`
  assert.equal(conv(cn).code, cn)
})

test('a style attribute on its own line is removed with its line', () => {
  const src = `const a = (
  <a
    href="/x"
    className="btn"
    style={{ background: 'var(--color-accent)', color: 'var(--color-accent-text)' }}
  >
    Go
  </a>
)
`
  assert.equal(conv(src).code, `const a = (
  <a
    href="/x"
    className="btn bg-accent text-accent-text"
  >
    Go
  </a>
)
`)
})

test('duplicate classes are not added twice; non-tsx files are untouched', () => {
  assert.match(conv(`const a = <p className="text-muted" style={{ color: 'var(--color-muted)' }} />`).code, /<p className="text-muted" \/>/)
  const ts = `const s = { color: 'var(--color-muted)' }`
  assert.equal(cm.convertInlineStyles(ts, 'x.ts').code, ts)
})

test('withTokenClasses only rewrites .tsx files that change', () => {
  const files = { 'a.tsx': `const a = <p style={{ color: 'var(--color-muted)' }} />`, 'b.ts': 'export const x = 1', 'c.tsx': 'export const y = <p />' }
  const out = cm.withTokenClasses(files)
  assert.match(out['a.tsx'], /text-muted/)
  assert.equal(out['b.ts'], files['b.ts'])
  assert.equal(out['c.tsx'], files['c.tsx'])
})

test('withThemeTokens inserts @theme after the last leading @import (quote-aware)', () => {
  const css = `@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

:root { --color-bg: #fff; }
`
  const out = build.withThemeTokens(css)
  const importEnd = css.indexOf('swap\');') + 'swap\');'.length
  assert.equal(out.slice(0, importEnd), css.slice(0, importEnd))
  assert.ok(out.indexOf('@theme {') > importEnd)
  assert.ok(out.indexOf('@theme {') < out.indexOf(':root'))
  assert.match(out, /--radius-store: var\(--radius, 8px\);/)
  assert.equal(build.withThemeTokens(out), out) // idempotent
  assert.equal(build.withThemeTokens(':root { --a: 1 }'), ':root { --a: 1 }') // no Tailwind entry → unchanged
})

test('buildStoreFiles injects the tokens into the store stylesheet (AI or scaffold fallback)', () => {
  const ai = build.buildStoreFiles({ 'styles/store.css': '@import "tailwindcss";\n:root { --color-bg: #000; }\n' })
  assert.match(ai.find((f) => f.path === 'styles/store.css').content, /@import "tailwindcss";\n\n\/\* store theme tokens \(platform\) \*\/\n@theme \{/)
  const fallback = build.buildStoreFiles({ 'data/config.ts': 'export const config = {}' })
  assert.match(fallback.find((f) => f.path === 'styles/store.css').content, /@theme \{/)
})
