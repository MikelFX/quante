// AssetraDigital design system (packages/ui): token table vs. stylesheet, CSS isolation from the
// Quante app, and the particle shape builders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../packages/ui/styles/assetra.css', import.meta.url), 'utf8')
const { tokens } = await import('../packages/ui/tokens.ts')
const shapes = await import('../packages/ui/particles/shapes.ts')

function block(selector) {
  const start = css.indexOf(selector + '{--bg:')
  assert.ok(start >= 0, `token block ${selector} not found`)
  const body = css.slice(start + selector.length + 1, css.indexOf('}', start))
  return Object.fromEntries(body.split(';').filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return [d.slice(0, i).trim().replace(/^--/, ''), d.slice(i + 1).trim()]
  }))
}

test('tokens.ts matches the dark token block in assetra.css', () => {
  const dark = block('\n.ad')
  for (const [k, v] of Object.entries(tokens.dark)) assert.equal(dark[k], v, `dark --${k}`)
})

test('tokens.ts matches the light token block in assetra.css', () => {
  const light = block('[data-theme="light"] .ad')
  for (const [k, v] of Object.entries(tokens.light)) assert.equal(light[k], v, `light --${k}`)
})

test('every rule is scoped under .ad (global CSS is never unloaded on navigation)', () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const offenders = []
  // top-level and nested selectors: anything before a "{" that is not an at-rule or keyframe step
  for (const m of noComments.matchAll(/(^|[{}])\s*([^{}@]+?)\s*\{/g)) {
    const sels = m[2].split(',').map((s) => s.trim())
    for (const s of sels) {
      if (/^(from|to|\d+(\.\d+)?%)$/.test(s)) continue
      if (s.includes('.ad')) continue
      offenders.push(s)
    }
  }
  assert.deepEqual(offenders, [])
})

test('keyframes are prefixed so they cannot override the app (spin, sheen, blink …)', () => {
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
  assert.ok(names.length > 30)
  for (const n of names) assert.ok(n.startsWith('ad-'), n)
  for (const m of css.matchAll(/animation(?:-name)?:([^;}]+)/g)) {
    for (const tok of m[1].match(/[a-zA-Z][\w-]*/g) ?? []) {
      if (names.includes('ad-' + tok)) assert.fail(`unprefixed animation name "${tok}" in: ${m[0]}`)
    }
  }
})

test('site.css does not reuse a class name of the design stylesheet by accident', () => {
  // A site-level rule on a design class leaks into every design component using it
  // (a honeypot `.hp` once moved the Harwo product grid `.hp` off screen).
  const site = readFileSync(new URL('../app/(site)/site.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const intentional = new Set(['frm', 'card', 'btn', 'bento']) // deliberate extensions, always qualified by a site class
  const designClasses = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))
  const clashes = new Set()
  for (const m of site.matchAll(/\.ad \.([a-z][a-z0-9-]*)/g)) {
    if (designClasses.has(m[1]) && !intentional.has(m[1])) clashes.add(m[1])
  }
  assert.deepEqual([...clashes], [])
})

test('3D particle shapes have N points normalised into [-1, 1]', () => {
  for (const key of ['@sphere', '@torus', '@cube', '@wave', '@logo']) {
    const s = shapes.buildShape(key, 1800, 1620, 'sans-serif')
    assert.equal(s.p.length, 1800 * 3, key)
    assert.ok(s.ex <= 1.0001 && s.ey <= 1.0001, key)
    for (let i = 0; i < s.p.length; i += 3) {
      assert.ok(Math.abs(s.p[i]) <= 1.0001 && Math.abs(s.p[i + 1]) <= 1.0001, `${key} point ${i / 3}`)
    }
  }
})

test('the AD logo keeps the last 10 % of points for the mint pixel', () => {
  const N = 1300
  const lineN = N - Math.floor(N * 0.1)
  const s = shapes.buildShape('@logo', N, lineN, 'sans-serif')
  assert.equal(s.flat, true)
  // pixel points cluster in a small square; outline points spread over the whole mark
  const spread = (from, to) => {
    let x0 = 9, x1 = -9
    for (let i = from; i < to; i++) { x0 = Math.min(x0, s.p[i * 3]); x1 = Math.max(x1, s.p[i * 3]) }
    return x1 - x0
  }
  assert.ok(spread(lineN, N) < 0.4)
  assert.ok(spread(0, lineN) > 1.5)
})

test('text keys are recognised as text, 3D keys are not', () => {
  for (const k of ['WEB', 'E-SHOP', '§', '0 Kč', '@', 'AGENT']) assert.equal(shapes.isTextKey(k), true, k)
  for (const k of ['@sphere', '@torus', '@cube', '@wave', '@logo']) assert.equal(shapes.isTextKey(k), false, k)
})

test('every --q-* token used by the app is defined for both themes', async () => {
  const { readdirSync, statSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const tokensCss = readFileSync(new URL('../packages/ui/styles/app-tokens.css', import.meta.url), 'utf8')
  const darkBlock = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf(':root[data-theme="light"]'))
  const lightBlock = tokensCss.slice(tokensCss.indexOf(':root[data-theme="light"]'))
  const defined = (block) => new Set([...block.matchAll(/(--q-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
  const dark = defined(darkBlock)
  const light = defined(lightBlock)
  const used = new Set()
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = dir + '/' + f
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|css)$/.test(f)) for (const m of readFileSync(p, 'utf8').matchAll(/var\((--q-[a-z0-9-]+)/g)) used.add(m[1])
    }
  }
  for (const d of ['app', 'components', 'packages']) walk(fileURLToPath(new URL('../' + d, import.meta.url)))
  const fontOnly = new Set(['--q-sans', '--q-mono', '--q-disp', '--q-ease']) // theme-independent
  const missing = [...used].filter((t) => !dark.has(t) || (!light.has(t) && !fontOnly.has(t)))
  assert.deepEqual(missing, [])
  assert.ok(used.size > 20)
})
