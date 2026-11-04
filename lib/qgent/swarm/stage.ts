// Qgent swarm: how the stage lays the layers out (pure, shared by the client and the tests).
// Consecutive product cards become one row of cards (their nested layers drawn inside the card),
// consecutive menu / footer links become one row of links; everything else is one block.

import type { Layer } from './layers.ts'

export type StageBlock =
  | { type: 'layer'; layer: Layer }
  | { type: 'links'; layers: Layer[] }
  | { type: 'cards'; cards: Array<{ card: Layer; parts: Layer[] }> }

export function groupLayers(layers: Layer[]): StageBlock[] {
  const out: StageBlock[] = []
  let i = 0
  while (i < layers.length) {
    const l = layers[i]
    if (l.kind === 'product') {
      const cards: Array<{ card: Layer; parts: Layer[] }> = []
      while (i < layers.length && layers[i].kind === 'product') {
        const card = layers[i]
        const parts: Layer[] = []
        i++
        while (i < layers.length && layers[i].depth > card.depth && layers[i].kind !== 'product') parts.push(layers[i++])
        cards.push({ card, parts })
        // stop the row when the next sibling isn't another card at the same level
        if (i < layers.length && !(layers[i].kind === 'product' && layers[i].depth === card.depth)) break
      }
      out.push({ type: 'cards', cards })
      continue
    }
    if (l.kind === 'link') {
      const run: Layer[] = []
      while (i < layers.length && layers[i].kind === 'link' && layers[i].depth === l.depth) run.push(layers[i++])
      out.push(run.length > 1 ? { type: 'links', layers: run } : { type: 'layer', layer: run[0] })
      continue
    }
    out.push({ type: 'layer', layer: l })
    i++
  }
  return out
}

/** How long the scan line takes over the page, in ms (before the speed multiplier). */
export function scanDuration(layers: number): number {
  return Math.max(7_000, Math.min(16_000, layers * 45))
}

/** Points on a circle for the waiting swarm (like the end of the reference video). */
export function swarmCircle(n: number, cx: number, cy: number, r: number): Array<{ x: number; y: number }> {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const wobble = i % 2 ? 0.82 : 1
    return { x: Math.round(cx + Math.cos(a) * r * wobble), y: Math.round(cy + Math.sin(a) * r * wobble) }
  })
}
