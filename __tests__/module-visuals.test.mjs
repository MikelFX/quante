// Animated module demos (app/(site)/_components/ModuleVisual.tsx + app/(site)/module-visuals.css):
// scoped like the design system, cheap to animate, and honest about which modules are in development.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../app/(site)/module-visuals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const design = readFileSync(new URL('../packages/ui/styles/assetra.css', import.meta.url), 'utf8')
const tsx = readFileSync(new URL('../app/(site)/_components/ModuleVisual.tsx', import.meta.url), 'utf8')
const modules = readFileSync(new URL('../content/assetra/modules.ts', import.meta.url), 'utf8')

const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]

test('every rule is scoped under .ad', () => {
  const rules = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '')
  const offenders = []
  for (const m of rules.matchAll(/(^|[{}])\s*([^{}@]+?)\s*\{/g)) {
    for (const s of m[2].split(',').map((x) => x.trim())) if (!s.startsWith('.ad ')) offenders.push(s)
  }
  assert.deepEqual(offenders, [])
})

test('keyframes are prefixed ad-mv- and only move transform, opacity or clip-path', () => {
  assert.ok(keyframes.length > 20)
  for (const [, name, body] of keyframes) {
    assert.ok(name.startsWith('ad-mv-'), name)
    for (const prop of body.matchAll(/([a-z-]+)\s*:/g)) {
      assert.ok(['transform', 'opacity', 'clip-path'].includes(prop[1]), `${name} animates ${prop[1]}`)
    }
  }
})

test('class names do not reuse a design-system class (they would inherit its styles)', () => {
  const designClasses = new Set([...design.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))
  const ours = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))
  const allowed = new Set(['ad', 'pv', 'mod-demo'])
  const clashes = [...ours].filter((c) => designClasses.has(c) && !allowed.has(c))
  assert.deepEqual(clashes, [])
  const used = new Set([...tsx.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)].flatMap((m) => (m[1] ?? m[2]).split(/\s+/)))
  const clashTsx = [...used].filter((c) => /^[a-z][a-z0-9-]*$/.test(c) && designClasses.has(c) && !allowed.has(c))
  assert.deepEqual(clashTsx, [])
})

test('only modules in development carry the "Ve vývoji" label', () => {
  const status = Object.fromEntries([...modules.matchAll(/slug: '(\w+)',[\s\S]*?status: '(\w+)'/g)].map((m) => [m[1], m[2]]))
  assert.ok(Object.keys(status).length >= 6)
  for (const [slug, st] of Object.entries(status)) {
    const block = tsx.split(`case '${slug}':`)[1]?.split(/\n    case '/)[0]
    assert.ok(block, `no visual for ${slug}`)
    assert.equal(/<Frame[^>]*\bdev>/.test(block), st === 'dev', slug)
  }
})
