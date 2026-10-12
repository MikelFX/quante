// Particle formations (packages/ui/particles/formation.ts). Owner, 2026-10-12: every zone keeps its
// own formation on its place — it turns and changes shape there but never travels, and the mouse or a
// finger don't move it (step() takes no pointer at all). The dot grid's waves come from a mouse only.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { Formation, canvasPad } = await import('../packages/ui/particles/formation.ts')
const { buildShape } = await import('../packages/ui/particles/shapes.ts')
const { ripplesFrom } = await import('../packages/ui/particles/ripples.ts')

const N = 1800
const LINE_N = N - Math.floor(N * 0.1)
const shape = (key) => buildShape(key, N, LINE_N, 'sans-serif')

// Zones as the site and the app size them (w × h), with the 3D shapes they show.
const ZONES = [
  { w: 640, h: 640, keys: ['@logo', '@sphere', '@torus', '@cube'] }, // homepage hero, desktop
  { w: 340, h: 340, keys: ['@logo', '@sphere', '@torus', '@cube'] }, // homepage hero, phone
  { w: 600, h: 240, keys: ['@wave'] }, // Ukázka práce
  { w: 1268, h: 320, keys: ['@logo', '@sphere'] }, // footer
  { w: 700, h: 180, keys: ['@cube', '@sphere'] }, // /new while generating
  { w: 330, h: 122, keys: ['@logo'] }, // Qgent panel header
]

test('every pose of every shape fits the canvas the zone gets', () => {
  for (const z of ZONES) {
    const pad = canvasPad(z.keys, z.w, z.h)
    const f = new Formation(N)
    for (const key of z.keys) {
      const s = shape(key)
      for (let T = 0; T < 40; T += 0.25) {
        f.step(s, T, z.w, z.h, true, true)
        for (let i = 0; i < N; i++) {
          assert.ok(Math.abs(f.tx[i]) <= z.w / 2 + pad.x - 16, `${key} in ${z.w}×${z.h}: x ${f.tx[i]} at T ${T}`)
          assert.ok(Math.abs(f.ty[i]) <= z.h / 2 + pad.y - 16, `${key} in ${z.w}×${z.h}: y ${f.ty[i]} at T ${T}`)
        }
      }
    }
  }
})

// A word as the text sampler makes it, without a DOM: points spread over a flat, wide box.
function word(seed) {
  let a = seed
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const p = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    p[i * 3] = rnd() * 2 - 1
    p[i * 3 + 1] = (rnd() * 2 - 1) * 0.35
    p[i * 3 + 2] = (rnd() - 0.5) * 0.025
  }
  return { p, ex: 1, ey: 0.35, flat: true, text: true }
}

/** Runs the zone's shapes in turn (4.8 s each at 60 fps, a burst at every change, as the engine does). */
function cycle(z, shapes, rounds, onSettled) {
  const pad = canvasPad(z.keys, z.w, z.h)
  const f = new Formation(N)
  let worstOut = 0
  let frame = 0
  for (let round = 0; round < rounds; round++) {
    for (const s of shapes) {
      f.burst(1.5)
      for (let k = 0; k < 288; k++, frame++) {
        f.step(s, frame / 60, z.w, z.h, true, frame === 0)
        let out = 0
        for (let i = 0; i < N; i++) {
          if (Math.abs(f.px[i]) > z.w / 2 + pad.x || Math.abs(f.py[i]) > z.h / 2 + pad.y) out++
        }
        worstOut = Math.max(worstOut, out / N)
      }
      onSettled(f, s)
    }
  }
  return worstOut
}

test('changing shape, the dots stay around the zone and settle on the new shape', () => {
  for (const z of ZONES.slice(0, 2)) {
    const worstOut = cycle(z, z.keys.map(shape), 2, (f, s) => {
      // A turning 3D shape drags its softest dots a little behind (in proportion to its size);
      // flat shapes settle exactly.
      let far = 0
      let sum = 0
      for (let i = 0; i < N; i++) {
        const d = Math.hypot(f.px[i] - f.tx[i], f.py[i] - f.ty[i])
        far = Math.max(far, d)
        sum += d
      }
      assert.ok(far < 0.2 * f.sc, `a dot is ${far.toFixed(1)} px from its place (scale ${f.sc.toFixed(0)})`)
      assert.ok(sum / N < (s.flat ? 0.01 : 0.04) * f.sc, `mean distance ${(sum / N).toFixed(2)} px`)
    })
    assert.ok(worstOut < 0.005, `${z.w}×${z.h}: ${(worstOut * 100).toFixed(2)} % of the dots left the canvas at once`)
  }
})

test('words changing into words stay around their zone', () => {
  for (const [w, h] of [[600, 340], [600, 210], [330, 122]]) {
    const z = { w, h, keys: ['WEB', 'E-SHOP', 'SPRÁVA'] }
    const worstOut = cycle(z, [word(1), word(2), word(3)], 2, () => {})
    assert.ok(worstOut < 0.003, `${w}×${h}: ${(worstOut * 100).toFixed(2)} % of the dots left the canvas at once`)
  }
})

test('with animations off it holds still', () => {
  const f = new Formation(N)
  for (const key of ['@logo', '@sphere', '@torus', '@cube', '@wave']) {
    const s = shape(key)
    f.step(s, 3, 600, 340, false, false)
    const x = Float32Array.from(f.px)
    const y = Float32Array.from(f.py)
    f.step(s, 47, 600, 340, false, false)
    assert.deepEqual(f.px, x, key)
    assert.deepEqual(f.py, y, key)
  }
})

test('a formation coming into view is already formed', () => {
  const f = new Formation(N)
  f.burst(7)
  f.step(shape('@torus'), 12, 600, 340, true, true)
  assert.deepEqual(f.px, f.tx)
  assert.deepEqual(f.py, f.ty)
  assert.ok(f.vx.every((v) => v === 0) && f.vy.every((v) => v === 0))
})

test('only the 3D shapes that reach past the zone get a bigger canvas', () => {
  const words = canvasPad(['WEB', 'E-SHOP', 'SPRÁVA'], 600, 340)
  assert.deepEqual(canvasPad(['@logo'], 600, 340), words)
  assert.deepEqual(canvasPad(['@wave', 'HARWO'], 600, 240), canvasPad(['HARWO'], 600, 240))
  assert.ok(words.x < 0.25 * 600 && words.y < 0.25 * 340, JSON.stringify(words))
  const hero = canvasPad(['@logo', '@sphere', '@torus', '@cube'], 640, 640)
  assert.ok(hero.x > 200 && hero.y > hero.x, JSON.stringify(hero)) // the cube's corners
})

test('only a mouse makes waves on the dot grid', () => {
  assert.equal(ripplesFrom('mouse'), true)
  for (const t of ['touch', 'pen', '']) assert.equal(ripplesFrom(t), false, t)
})
