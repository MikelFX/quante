// Qads Tiktoker (lib/qads/tiktoker.ts + lib/qads/pricing.ts): the launch offer is at cost and ends
// by itself, character requests only ever carry allowlisted traits, and the video prompt always
// carries the exact spoken line.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const P = await import('../lib/qads/pricing.ts')
const T = await import('../lib/qads/tiktoker.ts')

const during = new Date('2026-11-10T12:00:00Z')
const after = new Date('2026-11-28T12:00:00Z')

test('the launch offer lasts 30 days', () => {
  const days = (Date.parse(P.TIKTOKER_LAUNCH.endsAt) - Date.parse(P.TIKTOKER_LAUNCH.startsAt)) / 86_400_000
  assert.equal(days, 30)
  assert.equal(P.isTiktokerLaunch(during), true)
  assert.equal(P.isTiktokerLaunch(after), false)
  assert.equal(P.isTiktokerLaunch(new Date(P.TIKTOKER_LAUNCH.endsAt)), false)
})

test('launch price covers our cost even at the cheapest credit, without a margin on top', () => {
  for (const s of P.TIKTOKER_DURATIONS) {
    const c = P.computeTiktokerCost(1, s, during)
    const cost = s * P.TIKTOKER_MODELS.video.usdPerSecondNow + P.TIKTOKER_MODELS.scriptUsd
    assert.ok(c.totalCredits * P.USD_PER_CREDIT_FLOOR >= cost, `${s}s covers cost`)
    // At cost = the smallest whole number of credits per part (video, script) that covers it.
    assert.equal(c.videoCredits, Math.ceil((s * P.TIKTOKER_MODELS.video.usdPerSecondNow) / P.USD_PER_CREDIT_FLOOR))
    assert.equal(c.scriptCredits, 1)
    assert.equal(c.launch, true)
  }
  assert.ok(P.characterCredits(during) * P.USD_PER_CREDIT_FLOOR >= P.TIKTOKER_MODELS.character.usdPerSheet)
})

test('after the launch the price earns a margin even at Higgsfield list price', () => {
  for (const s of P.TIKTOKER_DURATIONS) {
    const c = P.computeTiktokerCost(1, s, after)
    const listCost = s * P.TIKTOKER_MODELS.video.usdPerSecondList + P.TIKTOKER_MODELS.scriptUsd
    assert.ok(c.totalCredits * P.USD_PER_CREDIT_FLOOR >= 1.8 * listCost, `${s}s margin`)
    assert.ok(c.totalCredits > P.computeTiktokerCost(1, s, during).totalCredits)
  }
})

test('variants scale the video part only; nothing is ever free', () => {
  const one = P.computeTiktokerCost(1, 15, during)
  const two = P.computeTiktokerCost(2, 15, during)
  assert.equal(two.videoCredits, 2 * one.videoCredits)
  assert.equal(two.scriptCredits, one.scriptCredits)
  assert.ok(P.tiktokerVideoCredits(0, during) >= 1)
  assert.ok(P.tiktokerVideoCredits(NaN, after) >= 1)
})

test('character requests keep only allowlisted traits', () => {
  const json = T.buildCharacterRequestJson({ gender: 'male', age: 'senior', hair: 'hs_horns', evil: 'x' }, '  freckles,\n warm smile ')
  const req = T.parseCharacterRequest(json)
  assert.ok(req)
  assert.deepEqual(req.selection, { gender: ['male'], age: ['senior'] })
  assert.match(req.brief, /freckles, warm smile$/)
  assert.equal(req.tier, 'normal')
  // A tampered stored request is cleaned again, unknown keys refused.
  const tampered = JSON.stringify({ tier: 'normal', brief: 'x', selection: { gender: ['male'], body_type: ['body_ultra'] } })
  assert.deepEqual(T.parseCharacterRequest(tampered).selection, { gender: ['male'] })
  assert.equal(T.parseCharacterRequest(JSON.stringify({ tier: 'freak', brief: '', selection: {} })), null)
  assert.equal(T.parseCharacterRequest('not json'), null)
})

test('traits survive the trip through the URL', () => {
  const t = { gender: 'female', age: 'mature', aesthetic: 'retro' }
  assert.deepEqual(T.traitsFromParam(T.traitsToParam(t)), t)
  assert.deepEqual(T.traitsFromParam('female.<script>.casual'), { gender: 'female', aesthetic: 'casual' })
  assert.deepEqual(T.traitsFromParam(null), {})
})

test('the video prompt always carries the spoken line verbatim', () => {
  const script = 'Tohle je moje nová láhev. Drží vodu studenou celý den.'
  const fixed = T.withSpokenLine('A selfie video of the person holding the bottle.', script, 'cs')
  assert.ok(T.promptCarriesScript(fixed, script))
  assert.match(fixed, /says in Czech/)
  const already = `Video. The person says in Czech: "${script}"`
  assert.equal(T.withSpokenLine(already, script, 'cs'), already)
})

test('a stored video item round-trips; anything else is refused', () => {
  const id = '3f1c2b9e-0a4d-4c55-9d7e-2b1f0c9a8e77'
  assert.deepEqual(T.decodeTiktokerItem(T.encodeTiktokerItem('p', id)), { prompt: 'p', characterId: id })
  assert.equal(T.decodeTiktokerItem('plain prompt'), null)
  assert.equal(T.decodeTiktokerItem(JSON.stringify({ v: 2, prompt: 'p', character: id })), null)
})

test('the script word budget fits the clip', () => {
  assert.ok(T.wordBudget(10) <= 23 && T.wordBudget(10) >= 15)
  assert.ok(T.wordBudget(15) <= 35 && T.wordBudget(15) >= 25)
})
