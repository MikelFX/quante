// Qads ad videos (lib/qads/pricing.ts): 1080p up to 30 s, priced from the real Higgsfield cost
// with a small margin — never below cost, even at the cheapest credit we sell.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const P = await import('../lib/qads/pricing.ts')
const mapper = readFileSync(new URL('../lib/qads/media/providers/higgsfield/mapper.ts', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/qads/generate/route.ts', import.meta.url), 'utf8')

test('a video never costs us more than it brings in, at any length', () => {
  for (let s = 4; s <= 30; s++) {
    const credits = P.creditsPerItem('video', s)
    const cost = s * P.HIGGSFIELD_MODELS.video.usdPerUnit
    assert.ok(credits * P.USD_PER_CREDIT_FLOOR >= cost, `${s}s covers cost`)
  }
})

test('the margin stays small (owner: "keep a small margin")', () => {
  const perSecond = P.QADS_GENERATOR_CREDIT_COSTS.videoPerSecond * P.USD_PER_CREDIT_FLOOR
  assert.ok(perSecond / P.HIGGSFIELD_MODELS.video.usdPerUnit <= 1.35)
})

test('videos render at 1080p, up to 30 s, and the API accepts 30 s', () => {
  const body = mapper.slice(mapper.indexOf('export function buildSeedanceVideoRequest'))
  assert.match(body.slice(0, 900), /resolution: '1080p'/)
  assert.match(body.slice(0, 900), /Math\.min\(30, Math\.max\(4,/)
  assert.match(route, /videoDurationSeconds: z\.number\(\)\.int\(\)\.min\(4\)\.max\(30\)/)
})
