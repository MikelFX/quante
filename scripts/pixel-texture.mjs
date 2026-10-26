// Generates the two pixel tiles of the design's dither texture (2 px cells, 96 × 96 cells,
// seeded, so the output never changes) and prints them as CSS data URIs:
//   --q-px       white and black specks with low alpha baked in — laid over surfaces as grain
//   --q-px-mask  82 % opaque cells — a mask that turns a soft glow into an airbrushed spray
// Paste the output into packages/ui/styles/app-tokens.css. Run: node scripts/pixel-texture.mjs
import { deflateSync } from 'node:zlib'

const CELLS = 96
const CELL = 2
const SIZE = CELLS * CELL

let seed = 0x5eed
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

// An indexed PNG: palette (rgb) + alpha (tRNS), one byte per pixel.
function png(cells, palette, alpha) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 3
  const raw = Buffer.alloc(SIZE * (SIZE + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE + 1)] = 0
    for (let x = 0; x < SIZE; x++) raw[y * (SIZE + 1) + 1 + x] = cells[((y / CELL) | 0) * CELLS + ((x / CELL) | 0)]
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('tRNS', Buffer.from(alpha)),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const grain = Array.from({ length: CELLS * CELLS }, () => {
  const r = rnd()
  return r < 0.28 ? 1 : r < 0.56 ? 2 : 0
})
const mask = Array.from({ length: CELLS * CELLS }, () => (rnd() < 0.82 ? 1 : 0))

const uri = (buf) => `url("data:image/png;base64,${buf.toString('base64')}")`
console.log(`--q-px: ${uri(png(grain, [[0, 0, 0], [255, 255, 255], [0, 0, 0]], [0, 8, 10]))};`)
console.log(`--q-px-mask: ${uri(png(mask, [[0, 0, 0], [0, 0, 0]], [0, 255]))};`)
