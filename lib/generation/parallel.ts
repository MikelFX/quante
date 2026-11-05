// Parallel store generation (used by the 20-agent build on /qgent). A generation normally is ONE
// model stream that writes every file in turn. Here it is split the way the storefront is built:
//
//   1. foundation — one call writes data/config.ts, styles/store.css and data/products.ts
//      (brand, theme, navigation, footer, catalogue: everything the pages read);
//   2. pages — then several calls run AT THE SAME TIME, each writing its own page component(s)
//      against the finished foundation files (home, product detail, collection, about, more pages).
//
// The pages only read the foundation through `@/data/config` and `@/data/products`, so they don't
// depend on each other and can be written side by side. This module is pure (messages, which
// files a part may write, how the separate streams merge into one raw output); the streaming
// itself is lib/generation/parallel-run.ts. Tested in __tests__/generation-parallel.test.mjs.

export const FOUNDATION_FILES = ['data/config.ts', 'styles/store.css', 'data/products.ts'] as const

export type ParallelPartId = 'home' | 'detail' | 'collection' | 'about' | 'pages'

export interface ParallelPart {
  id: ParallelPartId
  /** what the writer is asked to output */
  task: string
  /** may this part write `path`? (anything else it outputs is dropped) */
  owns: (path: string) => boolean
}

const CORE_PAGE_FILES = new Set([
  'components/store/HomePage.tsx',
  'components/store/ProductDetailPage.tsx',
  'components/store/CollectionPage.tsx',
  'components/store/AboutPage.tsx',
])

// Routes the scaffold already serves (or that are platform-managed): the "more pages" writer
// must not write these.
const SCAFFOLD_ROUTES = new Set(['', 'about', 'products', 'collections', 'cart', 'checkout', 'success', 'terms', 'privacy', 'cookies', 'contact', 'api'])

const only = (file: string) => (path: string) => path === file

export const PARALLEL_PARTS: readonly ParallelPart[] = [
  { id: 'home', task: 'components/store/HomePage.tsx (file 4 of the spec: hero → product showcase → value props → social proof → email capture)', owns: only('components/store/HomePage.tsx') },
  { id: 'detail', task: 'components/store/ProductDetailPage.tsx (file 5 of the spec)', owns: only('components/store/ProductDetailPage.tsx') },
  { id: 'collection', task: 'components/store/CollectionPage.tsx (file 6 of the spec)', owns: only('components/store/CollectionPage.tsx') },
  { id: 'about', task: 'components/store/AboutPage.tsx (file 7 of the spec: the brand story, real copy)', owns: only('components/store/AboutPage.tsx') },
  {
    id: 'pages',
    task:
      'the OPTIONAL PAGES only: for every link in config.nav and config.footer.columns that points to a page the scaffold does not already serve ' +
      '(the scaffold serves /, /about, /products/…, /collections/…, /cart, /checkout, /success, and the platform serves /terms, /privacy, /cookies, /contact), ' +
      'write app/<pagename>/page.tsx + components/store/<Name>Page.tsx as the spec describes. If there is no such link, output nothing at all',
    owns: (path) => {
      if (CORE_PAGE_FILES.has(path)) return false
      if (/^components\/store\/[A-Za-z0-9]+\.tsx$/.test(path)) return true
      const m = /^app\/([a-z0-9-]+)\/page\.tsx$/.exec(path)
      return !!m && !SCAFFOLD_ROUTES.has(m[1])
    },
  },
] as const

/** Step 1: the brief plus "write only the foundation". */
export function foundationMessage(brief: string): string {
  return (
    `${brief}\n\n` +
    '[Parallel build, step 1 of 2. Several writers build this store at the same time: in this step you write ONLY the <summary> ' +
    `and these three files, in this order: ${FOUNDATION_FILES.join(', ')}. Do not write any page component; the other writers ` +
    'write the pages next, from your files. So config.nav and config.footer.columns must already link every page the store ' +
    'will have, and config.brand / config.seo must carry the final brand name and copy direction. This replaces rule 14 for this step.]'
  )
}

/** Step 2: the brief, the finished foundation files (read-only) and this writer's own files. */
export function partMessage(brief: string, foundation: Record<string, string>, part: ParallelPart): string {
  const files = FOUNDATION_FILES.map((p) => `=== ${p} (already written, read-only) ===\n${foundation[p] ?? ''}`).join('\n\n')
  return (
    `${brief}\n\n` +
    '[Parallel build, step 2 of 2. The foundation of this store is finished; its files are below. You are one of several ' +
    'writers working at the same time, each on different files, so this replaces rule 14: output ONLY ' +
    `${part.task}. No <summary>, and never output the foundation files again. Read the brand, currency, language, products ` +
    'and theme from @/data/config and @/data/products exactly as defined below; copy must match them (same brand name, same language).]\n\n' +
    files
  )
}

const FILE_BLOCK = /<file path="([^"]{1,200})">[\s\S]*?<\/file>/g

/** Removes complete file blocks this part may not write (a writer echoing a foundation file, …). */
export function keepOwnFiles(raw: string, owns: (path: string) => boolean): string {
  return raw.replace(FILE_BLOCK, (block, path: string) => (owns(path.trim()) ? block : ''))
}

/** Splits a stream into its complete part (up to the last `</file>`) and the tail still being written. */
export function splitAtLastFile(raw: string): { complete: string; tail: string } {
  const i = raw.lastIndexOf('</file>')
  if (i < 0) return { complete: '', tail: raw }
  return { complete: raw.slice(0, i + 7), tail: raw.slice(i + 7) }
}

/**
 * Merges the foundation stream and the page streams into one raw output, as if one model had
 * written it: first every COMPLETE file block of every stream, then the tails still being
 * written. A tail never contains `</file>`, so a block that is still open in one stream can't be
 * closed by another stream's `</file>` (extractFileBlocks and fileProgress stay correct), and
 * every open tail is visible as a file "being written" at the same time.
 */
export function mergeParallelOutput(foundation: string, parts: ReadonlyArray<{ part: ParallelPart; raw: string }>): string {
  const f = splitAtLastFile(keepOwnFiles(foundation, (p) => (FOUNDATION_FILES as readonly string[]).includes(p)))
  const ps = parts.map(({ part, raw }) => splitAtLastFile(keepOwnFiles(raw.replace(/<summary>[\s\S]*?<\/summary>/g, ''), part.owns)))
  // only foundation tails that open a file: anything else (the summary) is already complete text
  const tails = [f.tail, ...ps.map((p) => p.tail)].map((t) => {
    const open = t.indexOf('<file path="')
    return open < 0 ? '' : t.slice(open)
  })
  const summary = /<summary>[\s\S]*?<\/summary>/.exec(f.tail)?.[0] ?? ''
  return [f.complete, summary, ...ps.map((p) => p.complete), ...tails].filter(Boolean).join('\n')
}

/** Every foundation file is complete in this raw output. */
export function foundationComplete(files: Record<string, string>): boolean {
  return FOUNDATION_FILES.every((p) => typeof files[p] === 'string' && files[p].trim().length > 0)
}
