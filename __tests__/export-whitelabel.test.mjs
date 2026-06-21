// White-label scrub test — runs with Node.js built-in test runner (no dependencies).
// Usage: node --experimental-vm-modules --test __tests__/export-whitelabel.test.mjs
// Or via: npm run test:whitelabel

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Inline the scrub logic (must stay in sync with lib/export-scrub.ts scrubContent)
function scrubContent(content) {
  content = content.replace(/Generated with \*\*Quante\*\*[^\n]*/gi, '')
  content = content.replace(/built with Quante[^\n]*/gi, '')
  content = content.replace(/\*[^*]*built with Quante[^*]*\*/gi, '')
  content = content.replace(/https?:\/\/[a-z0-9.-]*quante\.[a-z.]+[^\s"')>]*/gi, '')
  content = content.replace(/[a-z0-9-]+\.quante\.(app|io)[^\s"')>]*/gi, '')
  content = content.replace(/quante-cart/gi, 'store-cart')
  content = content.replace(/QUANTE/g, 'BUILDER')
  content = content.replace(/Quante/g, 'Builder')
  content = content.replace(/quante/g, 'builder')
  return content
}

function hasQuanteRef(content) {
  return /quante/i.test(content)
}

// ─── Fixtures: strings that should be completely scrubbed ────────────────────

const fixtures = [
  {
    name: 'localStorage key',
    input: "localStorage.getItem('quante-cart')",
    expectClean: true,
  },
  {
    name: 'QUANTE_API_URL env var',
    input: 'const url = process.env.QUANTE_API_URL ?? "https://quante.vercel.app"',
    expectClean: true,
  },
  {
    name: 'QUANTE_PROJECT_ID env var',
    input: 'const id = process.env.QUANTE_PROJECT_ID',
    expectClean: true,
  },
  {
    name: 'QUANTE_API_KEY env var',
    input: 'const key = process.env.QUANTE_API_KEY',
    expectClean: true,
  },
  {
    name: 'README attribution — bold',
    input: 'Generated with **Quante** — AI-native e-commerce builder.',
    expectClean: true,
  },
  {
    name: 'README footer',
    input: '*My Store — built with Quante.*',
    expectClean: true,
  },
  {
    name: 'quante.vercel.app URL',
    input: 'const base = "https://quante.vercel.app"',
    expectClean: true,
  },
  {
    name: 'quante.app subdomain URL',
    input: 'const shopUrl = "https://my-store.quante.app"',
    expectClean: true,
  },
  {
    name: 'unrelated content — must be unchanged',
    input: 'const price = 29.99\nexport default function ProductCard() { return null }',
    expectClean: true, // clean before AND after — should not be mangled
    expectUnchanged: true,
  },
]

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const result = scrubContent(fixture.input)
    const stillHasQuante = hasQuanteRef(result)

    if (fixture.expectClean) {
      assert.equal(
        stillHasQuante,
        false,
        `Expected no Quante refs after scrub, but got:\n  ${result}`
      )
    }

    if (fixture.expectUnchanged) {
      assert.equal(
        result,
        fixture.input,
        'Expected content to be unchanged after scrub'
      )
    }
  })
}

// ─── Full file simulation: scaffold with known Quante strings ─────────────────

test('full scaffold scrub — zero Quante refs in output', () => {
  const scaffoldFiles = [
    {
      path: 'lib/store/cart.ts',
      content: "const STORAGE_KEY = 'quante-cart'\nconst saved = localStorage.getItem(STORAGE_KEY)",
    },
    {
      path: 'app/api/checkout/route.ts',
      content: [
        "const quanteUrl = process.env.QUANTE_API_URL ?? 'https://quante.vercel.app'",
        "const projectId = process.env.QUANTE_PROJECT_ID",
        "const apiKey = process.env.QUANTE_API_KEY",
      ].join('\n'),
    },
    {
      path: 'README.md',
      content: [
        '# My Store',
        '> My tagline',
        '',
        'Generated with **Quante** — AI-native e-commerce builder.',
        '*My Store — built with Quante.*',
      ].join('\n'),
    },
    {
      path: 'app/page.tsx',
      content: "export default function HomePage() { return <main>Hello</main> }",
    },
    {
      path: 'data/config.ts',
      content: "export const config = { name: 'My Store', currency: 'EUR' }",
    },
  ]

  const scrubbed = scaffoldFiles.map((f) => ({ ...f, content: scrubContent(f.content) }))
  const hits = []

  for (const f of scrubbed) {
    const matches = f.content.match(/quante/gi)
    if (matches) hits.push(`${f.path}: ${matches.join(', ')}`)
  }

  assert.deepEqual(hits, [], `Quante refs found after scrub:\n${hits.join('\n')}`)
})
