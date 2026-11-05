// Qgent swarm, "build" mode: which parts of the new store exist yet. The generation streams the
// store as <file path="…">…</file> blocks (lib/generation/run.ts); the status poll reports the
// paths that are complete and the one being written (fileProgress), and the stage maps those
// paths onto the parts of a storefront the agents assemble (buildParts). Pure.

/**
 * Complete file paths and the files being written right now, from the raw model output. A
 * parallel generation (lib/generation/parallel.ts) puts every stream's complete blocks first and
 * the open tails after them, so several files can be open at once: `writingAll` lists them all,
 * `writing` is the first (kept for older clients).
 */
export function fileProgress(raw: string, max = 80): { done: string[]; writing: string | null; writingAll: string[] } {
  const done: string[] = []
  const re = /<file path="([^"]{1,200})">[\s\S]*?<\/file>/g
  let m: RegExpExecArray | null
  let lastEnd = 0
  while ((m = re.exec(raw))) {
    const p = m[1].trim()
    if (!done.includes(p) && done.length < max) done.push(p)
    lastEnd = re.lastIndex
  }
  const writingAll: string[] = []
  const open = /<file path="([^"]{1,200})">/g
  const tail = raw.slice(lastEnd)
  while ((m = open.exec(tail)) && writingAll.length < 12) {
    const p = m[1].trim()
    if (!writingAll.includes(p) && !done.includes(p)) writingAll.push(p)
  }
  return { done, writing: writingAll[0] ?? null, writingAll }
}

export type PartId = 'theme' | 'nav' | 'hero' | 'values' | 'products' | 'story' | 'detail' | 'collection' | 'footer' | 'pages'

export interface BuildPart {
  id: PartId
  label: string
  /** the agents (SWARM_AGENTS ids) that work on this part */
  agents: string[]
}

/** The storefront the agents assemble, top to bottom; every agent works on one part. */
export const BUILD_PARTS: readonly BuildPart[] = [
  { id: 'theme', label: 'Colours & type', agents: ['mobile', 'access'] },
  { id: 'nav', label: 'Navigation', agents: ['nav', 'seo'] },
  { id: 'hero', label: 'Hero', agents: ['headline', 'cta', 'copy'] },
  { id: 'values', label: 'Why buy here', agents: ['trust', 'shipping'] },
  { id: 'products', label: 'Products', agents: ['cards', 'price', 'alt'] },
  { id: 'story', label: 'Story', agents: ['typo', 'social'] },
  { id: 'detail', label: 'Product page', agents: ['detail', 'schema'] },
  { id: 'collection', label: 'Collections', agents: ['scout'] },
  { id: 'footer', label: 'Footer', agents: ['legal', 'checkout'] },
  { id: 'pages', label: 'More pages', agents: ['speed'] },
] as const

/** Which parts of the storefront a generated file builds. */
export function partsOf(path: string): PartId[] {
  const p = path.toLowerCase()
  if (p === 'styles/store.css' || p.endsWith('.css')) return ['theme']
  if (p === 'data/config.ts') return ['nav', 'footer']
  if (p === 'data/products.ts' || p.startsWith('data/')) return ['products']
  if (/navbar|header|menu/.test(p)) return ['nav']
  if (/footer/.test(p)) return ['footer']
  if (/homepage/.test(p) || p === 'app/page.tsx') return ['hero', 'values']
  if (/productdetail|products\/\[/.test(p)) return ['detail']
  if (/collection/.test(p)) return ['collection']
  if (/about|story|o-nas/.test(p)) return ['story']
  return ['pages']
}

export interface PartState { id: PartId; state: 'waiting' | 'building' | 'done'; files: number }

/**
 * The state of every part: done once a file that builds it is complete, building while such a
 * file is being written (several at once in a parallel generation). `finished` (the generation
 * completed) turns every part done.
 */
export function buildParts(done: string[], writing: string | readonly string[] | null, finished = false): PartState[] {
  const count = new Map<PartId, number>()
  for (const f of done) for (const id of partsOf(f)) count.set(id, (count.get(id) ?? 0) + 1)
  const open = writing == null ? [] : typeof writing === 'string' ? [writing] : writing
  const now = new Set(open.flatMap(partsOf))
  return BUILD_PARTS.map(({ id }) => ({
    id,
    files: count.get(id) ?? 0,
    state: finished || count.has(id) ? 'done' : now.has(id) ? 'building' : 'waiting',
  }))
}
