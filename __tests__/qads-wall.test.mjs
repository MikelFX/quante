// The Qads community wall choreography (app/qads/wall-math.ts): a strip at first, four rows at
// the end, every tile landing on its own slot, the same scatter on every visit.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { wallLayout, slotOf, tilePose, groupPose, landedAt, fillWall, rand, ROWS } = await import('../app/qads/wall-math.ts')

const W = 1440
const H = 900
const L = wallLayout(W, H)

test('the layout fits: columns by width, four rows in the viewport', () => {
  assert.ok(L.cols >= 3 && L.cols <= 8)
  const wallH = L.rows * L.tileH + (L.rows - 1) * L.gap
  const wallW = L.cols * L.tileW + (L.cols - 1) * L.gap
  assert.ok(wallH <= H * 0.8, `height ${wallH}`)
  assert.ok(wallW <= W * 0.95, `width ${wallW}`)
  assert.equal(wallLayout(390, 844).cols, 3)
})

test('every slot is used once and the strip is one row', () => {
  const seen = new Set()
  for (let i = 0; i < L.cols * ROWS; i++) {
    const s = slotOf(i, L)
    const key = s.r + ':' + s.c
    assert.ok(!seen.has(key), key)
    seen.add(key)
    if (i < L.cols) assert.equal(s.r, L.strip)
    else assert.notEqual(s.r, L.strip)
  }
  assert.equal(seen.size, L.cols * ROWS)
})

test('at first only the strip is on stage; in the end every tile sits on its slot, flat', () => {
  for (let i = 0; i < L.cols * ROWS; i++) {
    const start = tilePose(i, L, 0.1, W, H)
    if (i < L.cols) assert.equal(start.o, 1)
    else assert.equal(start.o, 0)
    const end = tilePose(i, L, 2, W, H)
    const s = slotOf(i, L)
    assert.ok(Math.abs(end.x - s.x) < 1e-6 && Math.abs(end.y - s.y) < 1e-6, `tile ${i}`)
    assert.ok(Math.abs(end.z) < 1e-6 && Math.abs(end.ry) < 1e-6 && end.o === 1 && Math.abs(end.s - 1) < 1e-6)
    assert.ok(landedAt(i, L) <= 2)
  }
})

test('the wall opens: tilted far back first, almost facing the viewer at the end', () => {
  const a = groupPose(0, L, H)
  const b = groupPose(2, L, H)
  assert.ok(a.tilt > 40 && b.tilt < 8)
  assert.ok(Math.abs(b.y - H * 0.1) < 1e-9)
  assert.ok(a.y < 0)
})

test('the scatter is deterministic and the wall is filled from the pool', () => {
  assert.equal(rand(3, 2), rand(3, 2))
  assert.ok(rand(3, 2) >= 0 && rand(3, 2) < 1)
  assert.deepEqual(fillWall(['u1'], ['s1', 's2'], 5), ['u1', 's1', 's2', 'u1', 's1'])
  assert.deepEqual(fillWall([], [], 3), [])
  // rows shift by three, so the tile below is never the same piece
  const wall = fillWall([], ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 14, 7)
  for (let c = 0; c < 7; c++) assert.notEqual(wall[c], wall[c + 7])
})
