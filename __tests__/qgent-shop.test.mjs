// Qgent in the Studio (shop mode): review output is cleaned, edits apply only where they match
// exactly once, the diff shows what changes, money-related changes are detected by code (not
// by the model) and an undo never throws away a later edit.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const s = await import('../packages/qgent/shop.ts')

const files = {
  'app/page.tsx': 'export default function Home() {\n  return (\n    <main>\n      <h1>Vítejte</h1>\n      <p>Doprava zdarma od 1500 Kč</p>\n    </main>\n  )\n}\n',
  'data/products.ts': "export const products = [\n  { id: 'a', name: 'Čaj', price: 190, slug: 'caj' },\n]\n",
  'data/config.ts': "export const config = { brand: { name: 'Lipová', currency: 'CZK' } }\n",
  'app/cart/page.tsx': "export default function Cart() { return <button>Objednat</button> }\n",
}

test('review output is capped, cleaned and limited to editable files', () => {
  const r = s.normalizeReview(
    {
      summary: 'Obchod je v pořádku.\u0007',
      findings: [
        { title: 'Chybí popis', why: 'x', area: 'Úvod', severity: 'urgent', edits: [{ path: 'app/page.tsx', find: 'Vítejte', replace: 'Vítejte v Lipové' }] },
        { title: 'Zamčený soubor', why: '', area: '', severity: 'high', edits: [{ path: 'app/api/checkout/route.ts', find: 'a', replace: 'b' }] },
        { title: '', edits: [] },
        { title: 'Prázdná úprava', severity: 'low', edits: [{ path: 'app/page.tsx', find: 'a', replace: 'a' }] },
        ...Array.from({ length: 20 }, (_, i) => ({ title: 'N' + i, severity: 'low', edits: [] })),
      ],
      adsBrief: { brand: 'Lipová', audience: 'milovníci čaje', tone: 'klidný', products: [{ name: 'Čaj', description: 'Sypaný' }, { name: '' }] },
    },
    (p) => p in files && !p.startsWith('app/api/'),
  )
  assert.equal(r.findings.length, s.SHOP_LIMITS.findings)
  assert.equal(r.findings[0].severity, 'medium')
  assert.equal(r.findings[0].edits.length, 1)
  assert.equal(r.findings[1].edits.length, 0, 'locked file edit dropped, advice kept')
  assert.equal(r.findings[2].title, 'Prázdná úprava')
  assert.equal(r.findings[2].edits.length, 0)
  assert.doesNotMatch(r.summary, /\u0007/)
  assert.deepEqual(r.adsBrief.products, [{ name: 'Čaj', description: 'Sypaný' }])
  assert.equal(s.normalizeReview(null, () => true).findings.length, 0)
})

test('edits apply only when the text matches exactly once', () => {
  const ok = s.applyEdits(files, [{ path: 'app/page.tsx', find: '<h1>Vítejte</h1>', replace: '<h1>Vítejte v Lipové</h1>' }])
  assert.ok(ok.ok)
  assert.match(ok.after['app/page.tsx'], /Vítejte v Lipové/)
  assert.equal(ok.before['app/page.tsx'], files['app/page.tsx'])

  assert.equal(s.applyEdits(files, [{ path: 'app/page.tsx', find: 'neexistuje', replace: 'x' }]).ok, false)
  assert.equal(s.applyEdits(files, [{ path: 'app/page.tsx', find: 'main>', replace: 'section>' }]).ok, false, 'ambiguous')
  assert.equal(s.applyEdits(files, [{ path: 'app/nope.tsx', find: 'a', replace: 'b' }]).ok, false)
  // Edits on one file run in order.
  const two = s.applyEdits(files, [
    { path: 'app/page.tsx', find: 'Vítejte', replace: 'Ahoj' },
    { path: 'app/page.tsx', find: '<h1>Ahoj</h1>', replace: '<h1>Ahoj!</h1>' },
  ])
  assert.ok(two.ok)
  assert.match(two.after['app/page.tsx'], /<h1>Ahoj!<\/h1>/)
})

test('the diff shows removed and added lines with context', () => {
  const h = s.editHunks(files, [{ path: 'app/page.tsx', find: 'Vítejte', replace: 'Vítejte v Lipové' }])
  assert.equal(h.length, 1)
  assert.equal(h[0].path, 'app/page.tsx')
  assert.deepEqual(h[0].lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text.trim()), ['-<h1>Vítejte</h1>', '+<h1>Vítejte v Lipové</h1>'])
  assert.ok(h[0].lines.some((l) => l.t === ' '))
  assert.equal(h[0].line, 2)
})

test('money-related changes are detected by code', () => {
  const reasons = (edits) => {
    const r = s.applyEdits(files, edits)
    assert.ok(r.ok, r.error)
    return s.sensitiveReasons(r.before, r.after)
  }
  assert.deepEqual(reasons([{ path: 'app/page.tsx', find: '<h1>Vítejte</h1>', replace: '<h1>Dobrý den</h1>' }]), [])
  assert.ok(reasons([{ path: 'data/products.ts', find: 'price: 190', replace: 'price: 150' }]).includes('changes product prices'))
  assert.ok(reasons([{ path: 'data/config.ts', find: "currency: 'CZK'", replace: "currency: 'EUR'" }]).includes('changes the store currency'))
  assert.ok(reasons([{ path: 'app/cart/page.tsx', find: 'Objednat', replace: 'Koupit' }]).includes('changes the cart or order completion'))
  assert.deepEqual(reasons([{ path: 'app/page.tsx', find: 'od 1500 Kč', replace: 'od 990 Kč' }]), ['changes amounts in the text'])
  assert.ok(reasons([{ path: 'app/page.tsx', find: 'Doprava zdarma', replace: 'Doprava' }]).includes('changes text about shipping, payments or prices'))
  // Re-linking a menu item called "Doprava a platba" changes no money wording: not sensitive.
  const nav = { 'data/config.ts': '      { label: "Doprava a platba", href: "/about" },\n' }
  const rel = s.applyEdits(nav, [{ path: 'data/config.ts', find: 'href: "/about"', replace: 'href: "/terms"' }])
  assert.deepEqual(s.sensitiveReasons(rel.before, rel.after), [])
  // Removing a shipping promise is money-related.
  const gone = s.applyEdits(files, [{ path: 'app/page.tsx', find: '      <p>Doprava zdarma od 1500 Kč</p>\n', replace: '' }])
  assert.ok(s.sensitiveReasons(gone.before, gone.after).includes('changes amounts in the text'))
  // Renaming a product keeps its price: not sensitive.
  assert.deepEqual(reasons([{ path: 'data/products.ts', find: "name: 'Čaj'", replace: "name: 'Zelený čaj'" }]), [])
})

test('undo restores only what the action wrote and refuses after a later edit', () => {
  const r = s.applyEdits(files, [{ path: 'app/page.tsx', find: 'Vítejte', replace: 'Ahoj' }])
  const current = { ...files, ...r.after }
  const back = s.revertFiles(current, r.before, r.after)
  assert.ok(back.ok)
  assert.equal(back.files['app/page.tsx'], files['app/page.tsx'])
  const changedLater = { ...current, 'app/page.tsx': current['app/page.tsx'] + '\n// later' }
  assert.equal(s.revertFiles(changedLater, r.before, r.after).ok, false)
})

test('the review schema is closed (structured output)', () => {
  const walk = (node) => {
    if (node && typeof node === 'object') {
      if (node.type === 'object') assert.equal(node.additionalProperties, false)
      Object.values(node).forEach(walk)
    }
  }
  walk(s.REVIEW_SCHEMA)
})

test('the shop-mode routes keep their guards', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
  const act = read('app/api/projects/[id]/qgent/actions/[actionId]/route.ts')
  assert.match(act, /getOwnedProject/)
  assert.match(act, /needsSensitiveConfirm/, 'money changes need a second confirmation')
  assert.match(act, /sensitiveReasons\(r\.before, r\.after\)/, 'decided on the real change, not the stored proposal')
  assert.match(act, /rejectAiStoreFile/, 'safety filter again before saving')
  assert.match(act, /\.eq\('status', 'proposed'\)/, 'claimed before charging, so a double click applies once')
  assert.match(act, /refundDebit\(userId, versionId, 'qgent_apply'/)
  const rev = read('app/api/projects/[id]/qgent/review/route.ts')
  assert.match(rev, /getOwnedProject/)
  assert.match(rev, /refundDebit\(userId, reviewId, 'qgent_review'/)
  assert.match(read('lib/qgent/shop.ts'), /MODELS|ITERATION_MODEL/, 'uses the existing Quante Claude setup')
  const sql = read('supabase/migration-qgent-shop.sql')
  assert.match(sql, /ALTER TABLE qgent_actions ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON qgent_actions FROM anon, authenticated/)
})
