// The ripples on the website's dot grid (packages/ui/particles/ripples.ts): a packet travels
// outward at RIPPLE.speed, is calm far ahead of and far behind its front, fades with time and
// distance, and is dropped once it has faded.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { Ripples, RIPPLE } = await import('../packages/ui/particles/ripples.ts')

const out = { h: 0, dx: 0, dy: 0 }
const at = (r, x, y, t) => ({ ...r.sample(x, y, t, out) })

test('the front travels outward at the set speed and nothing moves ahead of it', () => {
  const r = new Ripples()
  r.add(0, 0, 0, 1, 1000)
  const t = 500
  const front = t * RIPPLE.speed
  assert.ok(Math.abs(at(r, front, 0, t).h) > 0.2, 'crest at the front')
  assert.equal(at(r, front + RIPPLE.width * 3, 0, t).h, 0, 'calm far ahead')
  assert.equal(at(r, 0, 0, 0).h, 0, 'nothing before it starts')
})

test('behind the front the water is calm again', () => {
  const r = new Ripples()
  r.add(0, 0, 0, 1, 2000)
  const t = 1500
  const front = t * RIPPLE.speed
  assert.ok(Math.abs(at(r, front - RIPPLE.width * 3, 0, t).h) < 0.01)
})

test('it fades with time and distance and is dropped when faded', () => {
  const r = new Ripples()
  r.add(0, 0, 0, 1, 800)
  const early = Math.abs(at(r, 200 * RIPPLE.speed, 0, 200).h)
  const late = Math.abs(at(r, 1200 * RIPPLE.speed, 0, 1200).h)
  assert.ok(early > late * 3, `early ${early} vs late ${late}`)
  r.prune(10000)
  assert.ok(r.empty)
})

test('the dot shift points along the ring (radially)', () => {
  const r = new Ripples()
  r.add(100, 100, 0, 1, 1000)
  const t = 400
  // Sample a quarter wavelength off the front, where the shift is largest.
  const d = t * RIPPLE.speed + RIPPLE.wavelength / 4
  const s = at(r, 100, 100 + d, t)
  assert.ok(Math.abs(s.dx) < 1e-9 && Math.abs(s.dy) > 0.05, JSON.stringify(s))
})

test('only the newest packets are kept', () => {
  const r = new Ripples()
  for (let i = 0; i < RIPPLE.max + 10; i++) r.add(i, 0, 0, 0.5, 500)
  assert.equal(r.list.length, RIPPLE.max)
  assert.equal(r.list[0].x, 10)
})

test('the lattice sum (used for drawing) equals sampling point by point', () => {
  const r = new Ripples()
  r.add(200, 150, 0, 1, 1000)
  r.add(260, 210, 120, 0.5, 600)
  r.add(-40, 400, 50, 0.8, 900)
  const step = 15, cols = 40, rows = 36, ox = 0, oy = -30, t = 420
  const H = new Float32Array(cols * rows), DX = new Float32Array(cols * rows), DY = new Float32Array(cols * rows)
  r.accumulate(t, ox, oy, step, cols, rows, H, DX, DY)
  let worst = 0
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const s = at(r, ox + i * step, oy + j * step, t)
    const k = j * cols + i
    worst = Math.max(worst, Math.abs(s.h - H[k]), Math.abs(s.dx - DX[k]), Math.abs(s.dy - DY[k]))
  }
  assert.ok(worst < 1e-4, 'max difference ' + worst)
})
