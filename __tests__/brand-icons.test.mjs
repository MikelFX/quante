// Brand icons (scripts/brand-icons.py): Google shows a site's favicon next to its search result only
// when it is square and a multiple of 48 px, and reads the schema.org logo as a raster image.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const png = (f) => {
  const b = readFileSync(f)
  assert.equal(b.toString('latin1', 1, 4), 'PNG', f)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

test('favicon.ico carries 16, 32 and 48 px', () => {
  const b = readFileSync('app/favicon.ico')
  const n = b.readUInt16LE(4)
  const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256).sort((a, z) => a - z)
  assert.deepEqual(sizes, [16, 32, 48])
})

test('raster icons are square, Google-sized where Google reads them', () => {
  for (const [f, s] of [['app/icon1.png', 96], ['app/icon2.png', 192], ['app/apple-icon.png', 180], ['public/apple-touch-icon.png', 180], ['public/icon-512.png', 512], ['public/icon-maskable-512.png', 512], ['public/logo.png', 512]]) {
    assert.deepEqual(png(f), [s, s], f)
  }
  for (const f of ['app/icon1.png', 'app/icon2.png']) assert.equal(png(f)[0] % 48, 0, f)
})

test('schema.org logo is the raster logo, and the manifest lists files that exist', () => {
  const ld = readFileSync('lib/agents/jsonld.ts', 'utf8')
  assert.match(ld, /\/logo\.png/)
  assert.doesNotMatch(ld, /logo: `\$\{SITE_ORIGIN\}\/icon\.svg`/)
  const manifest = readFileSync('app/manifest.ts', 'utf8')
  for (const [, src] of manifest.matchAll(/src: '\/([^']+)'/g)) {
    png(src.startsWith('icon-') ? `public/${src}` : `app/${src}`)
  }
})
