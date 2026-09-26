// Store theme (2026-09-26): config.design is the single source of the store's colors /
// fonts / radius. Covers the shared rules (lib/store-theme-shared.ts), their copy in the
// scaffold builder (lib/store-template/build.ts — must stay identical), the AST-based
// config.ts editor (lib/store-theme.ts) and the scaffold wiring (ThemeStyle, layout guard).
// Usage: node --test __tests__/store-theme.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const ROOT = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2)
      return nextResolve(new URL(base.endsWith('.ts') ? base : `${base}.ts`, ROOT).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const shared = await import(new URL('../lib/store-theme-shared.ts', import.meta.url).href)
const build = await import(new URL('../lib/store-template/build.ts', import.meta.url).href)
const editor = await import(new URL('../lib/store-theme.ts', import.meta.url).href)

const THEME = {
  colors: { bg: '#ffffff', surface: '#f4f4f4', text: '#111111', muted: '#6b7280', accent: '#ff0055', accentText: '#ffffff', border: '#e5e7eb' },
  fonts: { heading: "'Playfair Display', serif", body: 'Inter, sans-serif' },
  radius: '12px',
}

const CONFIG = `import type { StoreConfig } from "@/types/store-code"

// Brand copy written by the AI — must survive a theme edit untouched.
export const config: StoreConfig = {
  brand: { name: "Svit", tagline: "Candles; {not} </style> code", currency: "CZK", language: "cs", country: "CZ" },
  seo: { title: "Svit", description: "desc" },
  design: {
    colors: {
      bg: "#faf6ee",
      text: "#2a2418",
      accent: "#f2c94c",
      accentText: "#2a2418",
      muted: "#7a7364",
      surface: "#f4ede0",
      border: "#e6dcc7",
    },
    fonts: {
      heading: "Fraunces",
      body: "Inter",
    },
    radius: "4px",
  },
  nav: [{ label: \`Shop\`, href: "/collections/all" }],
  footer: { columns: [], legal: "" },
}
`

test('shared theme rules are identical to the copy the scaffold embeds', () => {
  assert.deepEqual({ ...shared.THEME_COLOR_VARS }, { ...build.THEME_COLOR_VARS })
  assert.equal(shared.THEME_COLOR_RE.source, build.THEME_COLOR_RE.source)
  assert.equal(shared.THEME_FONT_RE.source, build.THEME_FONT_RE.source)
  assert.equal(shared.THEME_RADIUS_RE.source, build.THEME_RADIUS_RE.source)
  assert.deepEqual(shared.THEME_FONT_OPTIONS.map((f) => ({ ...f })), build.THEME_FONT_OPTIONS.map((f) => ({ ...f })))
})

test('sanitizeTheme accepts a valid theme and refuses anything that could break out of CSS', () => {
  assert.deepEqual(shared.sanitizeTheme(THEME), THEME)
  const bad = (patch) => shared.sanitizeTheme({ ...THEME, ...patch })
  assert.equal(bad({ colors: { ...THEME.colors, bg: 'red;}</style><script>alert(1)</script>' } }), null)
  assert.equal(bad({ colors: { ...THEME.colors, bg: 'url(https://x.example/a.png)' } }), null)
  assert.equal(bad({ colors: { ...THEME.colors, accent: undefined } }), null)
  assert.equal(bad({ fonts: { heading: 'Inter; } body { display:none', body: 'Inter' } }), null)
  assert.equal(bad({ fonts: { heading: 'Inter<', body: 'Inter' } }), null)
  assert.equal(bad({ radius: '8px;color:red' }), null)
  assert.equal(bad({ radius: 'calc(1px)' }), null)
  assert.ok(bad({ colors: { ...THEME.colors, bg: 'rgb(255 255 255 / 50%)' } }))
  assert.ok(bad({ radius: '0' }))
  assert.ok(bad({ radius: '0.75rem' }))
})

test('themeFontsHref requests only offered Google Fonts with their real weights', () => {
  assert.equal(
    shared.themeFontsHref(["'Playfair Display', serif", 'Inter, sans-serif']),
    'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap',
  )
  assert.equal(shared.themeFontsHref(["'Instrument Serif', serif"]), 'https://fonts.googleapis.com/css2?family=Instrument+Serif:wght@400&display=swap')
  assert.equal(shared.themeFontsHref(['MyBrandFont, sans-serif']), null)
  assert.equal(shared.themeFontsHref(['Inter', 'Inter, sans-serif']), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')
})

test('themePreviewPayload maps the theme onto the store CSS variables', () => {
  const { vars, fontsHref } = shared.themePreviewPayload(THEME)
  assert.equal(vars['--color-accent-text'], '#ffffff')
  assert.equal(vars['--font-heading'], "'Playfair Display', serif")
  assert.equal(vars['--radius'], '12px')
  assert.equal(Object.keys(vars).length, 10)
  assert.ok(fontsHref?.startsWith('https://fonts.googleapis.com/css2?'))
})

test('readTheme reads config.design even when the rest of the file is not plain JSON5', () => {
  assert.deepEqual(editor.readTheme(CONFIG), {
    colors: { bg: '#faf6ee', surface: '#f4ede0', text: '#2a2418', muted: '#7a7364', accent: '#f2c94c', accentText: '#2a2418', border: '#e6dcc7' },
    fonts: { heading: 'Fraunces', body: 'Inter' },
    radius: '4px',
  })
})

test('writeTheme replaces only design.colors / fonts / radius and keeps everything else byte-for-byte', () => {
  const out = editor.writeTheme(CONFIG, THEME)
  assert.ok(out)
  assert.deepEqual(editor.readTheme(out), THEME)
  const before = (s) => s.slice(0, s.indexOf('    colors:'))
  const after = (s) => s.slice(s.indexOf('  },\n  nav:'))
  assert.equal(before(out), before(CONFIG))
  assert.equal(after(out), after(CONFIG))
  // The file's own color key order and multi-line layout are kept.
  assert.match(out, /colors: \{\n {6}bg: "#ffffff",\n {6}text: "#111111",\n {6}accent: "#ff0055",/)
  assert.equal(build.rejectAiStoreFile('data/config.ts', out), null)
})

test('writeTheme refuses configs whose design is not a plain literal', () => {
  assert.equal(editor.writeTheme(CONFIG.replace(/design: \{[\s\S]*?\n {2}\},\n/, 'design: baseDesign,\n'), THEME), null)
  assert.equal(editor.writeTheme(CONFIG.replace('radius: "4px",', ''), THEME), null)
  assert.equal(editor.writeTheme('export const x = 1\n', THEME), null)
})

test('the scaffold layout renders ThemeStyle, and an AI layout must keep it', () => {
  const files = build.getEditableScaffoldFiles()
  assert.match(files['app/layout.tsx'], /<ThemeStyle \/>/)
  const rejected = build.rejectAiStoreFile('app/layout.tsx', files['app/layout.tsx'].replace('<ThemeStyle />', ''))
  assert.match(rejected ?? '', /ThemeStyle/)
})

test('ThemeStyle / ThemeBridge are platform-locked and embed the shared rules', () => {
  for (const p of ['components/layout/ThemeStyle.tsx', 'components/layout/ThemeBridge.tsx']) {
    assert.ok(build.PLATFORM_LOCKED_FILES.has(p))
    assert.match(build.rejectAiStoreFile(p, 'export function X() { return null }\n') ?? '', /managed by the platform/)
  }
  const built = build.buildStoreFiles({ 'components/layout/ThemeStyle.tsx': 'export function ThemeStyle() { return null }\n' })
  const style = built.find((f) => f.path === 'components/layout/ThemeStyle.tsx').content
  assert.match(style, /html:root\{/)
  assert.ok(style.includes(JSON.stringify(shared.THEME_COLOR_RE.source)))
  const bridge = built.find((f) => f.path === 'components/layout/ThemeBridge.tsx').content
  assert.ok(bridge.includes(`'${shared.THEME_MESSAGE_SOURCE}'`))
  assert.match(bridge, /event\.source !== window\.parent/)
})
