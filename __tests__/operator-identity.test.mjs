// Quante is a product, not a company (owner, 2026-10-28): the operator and copyright holder is
// AssetraDigital s.r.o., read from the website's company data. These checks keep the old
// "QuanteCode s.r.o." from coming back and keep unfilled operator fields off the legal pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (p) => readFileSync(ROOT + p, 'utf8')

function* files(dir) {
  for (const name of readdirSync(ROOT + dir)) {
    const p = join(dir, name)
    if (statSync(ROOT + p).isDirectory()) yield* files(p)
    else if (/\.(tsx?|mjs|json)$/.test(name)) yield p
  }
}

test('no code names QuanteCode as a company', () => {
  for (const dir of ['app', 'components', 'lib', 'content', 'packages']) {
    for (const f of files(dir)) {
      assert.doesNotMatch(src(f), /QuanteCode\s+s\.\s?r\.\s?o\./i, `${f} names QuanteCode s.r.o.`)
    }
  }
})

test('the operator is the AssetraDigital company from the website data', () => {
  const cfg = src('lib/site-config.ts')
  assert.match(cfg, /import \{ company \} from '@\/content\/assetra\/site'/)
  assert.match(cfg, /const companyName\s+= company\.name/)
  assert.match(src('content/assetra/site.ts'), /name: 'AssetraDigital s\.r\.o\.'/)
  assert.match(src('components/SiteFooter.tsx'), /A product of \{operator\.companyName\}/)
})

test('legal pages never print an unfilled operator field', () => {
  for (const page of ['terms', 'privacy', 'cookies', 'refund']) {
    const s = src(`app/(marketing)/${page}/page.tsx`)
    assert.doesNotMatch(s, /(?<!isFilled\(operator\.address\) && <><br \/>)\{operator\.address\}/, `${page} prints operator.address unguarded`)
    assert.doesNotMatch(s, /contactEmail\.includes\('\[TO'\)/, `${page} uses isFilled()`)
  }
})
