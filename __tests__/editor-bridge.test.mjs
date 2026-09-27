// Visual editor v1 bridge (lib/editor/bridge.ts): origins, generated bridge source, and
// mounting it into the sandbox copy of app/layout.tsx.
// Usage: node --test __tests__/editor-bridge.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'

const B = await import(new URL('../lib/editor/bridge.ts', import.meta.url).href)
const build = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)

const parses = (code, name = 'x.tsx') => {
  const sf = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  return (sf.parseDiagnostics?.length ?? 0) === 0
}

test('origins: https (and http://localhost) only, normalised to the origin', () => {
  assert.deepEqual(
    B.sanitizeEditorOrigins(['https://quantecode.com/project/x', 'http://evil.com', 'javascript:alert(1)', 'http://localhost:3000', 'https://preview.quantecode.com', 'nope']),
    ['https://quantecode.com', 'http://localhost:3000', 'https://preview.quantecode.com'],
  )
})

test('the generated bridge parses and embeds only the sanitised origins', () => {
  const src = B.editorBridgeSource(['https://quantecode.com', 'http://evil.com'])
  assert.ok(parses(src))
  assert.match(src, /const ORIGINS: string\[\] = \["https:\/\/quantecode\.com"\]/)
  assert.match(src, /e\.source !== window\.parent \|\| !ORIGINS\.includes\(e\.origin\)/)
  assert.match(src, /'use client'/)
})

test('the bridge mounts into the scaffold layout before </body>', () => {
  const layout = build.buildStoreFiles({}).find((f) => f.path === 'app/layout.tsx').content
  const out = B.injectEditorBridge(layout)
  assert.ok(out)
  assert.ok(parses(out, 'layout.tsx'))
  assert.match(out, /^import \{ EditorBridge \} from '@\/components\/__editor\/EditorBridge'\n/)
  assert.ok(out.indexOf('<EditorBridge />') < out.indexOf('</body>'))
  assert.equal(B.injectEditorBridge('export default function L() { return <div /> }'), null)
})

test('a "use client" prologue stays first', () => {
  const out = B.injectEditorBridge(`'use client'\nimport x from 'y'\nexport default function L({children}) { return <html><body>{children}</body></html> }\n`)
  assert.match(out, /^'use client'\nimport \{ EditorBridge \}/)
})

test('the sandbox next.config allows the sandbox host for dev resources (HMR)', async () => {
  const { registerHooks } = await import('node:module')
  const ROOT = new URL('../', import.meta.url)
  registerHooks({ resolve(s, c, n) { if (s.startsWith('@/')) { const b = s.slice(2); return n(new URL(b.endsWith('.ts') ? b : `${b}.ts`, ROOT).href, c) } return n(s, c) } })
  const F = await import(new URL('../lib/editor/files.ts', import.meta.url).href)
  const cfg = build.buildStoreFiles({}).find((f) => f.path === 'next.config.ts').content
  const out = F.withEditorDevOrigins(cfg)
  assert.match(out, /const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.vercel.run'],
  devIndicators: false,/)
  assert.ok(parses(out, 'next.config.ts'))
  assert.equal(F.withEditorDevOrigins(out), out)
  const prepared = F.prepareEditorFiles({}, ['https://quantecode.com'])
  assert.match(prepared.files.find((f) => f.path === 'next.config.ts').content, /allowedDevOrigins/)
  // The deployed build never gets it.
  assert.doesNotMatch(cfg, /allowedDevOrigins/)
})
