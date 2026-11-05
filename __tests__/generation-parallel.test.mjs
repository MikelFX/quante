// Parallel generation (lib/generation/parallel.ts): the foundation, then every page writer at the
// same time; their streams merge into one raw output that the checkpoint, the status poll
// (fileProgress → several files being written at once) and the final parse all read correctly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (f) => readFileSync(ROOT + f, 'utf8')
const P = await import('../lib/generation/parallel.ts')
const B = await import('../lib/qgent/swarm/build.ts')
const K = await import('../lib/generation-checkpoint.ts')

const part = (id) => P.PARALLEL_PARTS.find((p) => p.id === id)
const file = (path, body = 'x') => `<file path="${path}">\n${body}\n</file>`
const FOUNDATION = `<summary>Coffee store, 4 products.</summary>\n${file('data/config.ts', 'export const config = {}')}\n${file('styles/store.css', ':root{}')}\n${file('data/products.ts', 'export const products = []')}`

test('five page writers, each owning its own files, none owning the foundation', () => {
  assert.deepEqual(P.PARALLEL_PARTS.map((p) => p.id), ['home', 'detail', 'collection', 'about', 'pages'])
  for (const f of P.FOUNDATION_FILES) assert.ok(P.PARALLEL_PARTS.every((p) => !p.owns(f)), f)
  const core = ['components/store/HomePage.tsx', 'components/store/ProductDetailPage.tsx', 'components/store/CollectionPage.tsx', 'components/store/AboutPage.tsx']
  for (const f of core) assert.equal(P.PARALLEL_PARTS.filter((p) => p.owns(f)).length, 1, f)
  const pages = part('pages')
  assert.ok(pages.owns('app/news/page.tsx') && pages.owns('components/store/NewsPage.tsx'))
  for (const f of ['app/about/page.tsx', 'app/contact/page.tsx', 'app/terms/page.tsx', 'app/api/x/route.ts', 'app/layout.tsx', 'components/layout/Navbar.tsx', 'components/store/HomePage.tsx']) assert.ok(!pages.owns(f), f)
})

test('messages: foundation writes only its files; a writer gets the finished foundation read-only', () => {
  const f = P.foundationMessage('BRIEF')
  assert.ok(f.startsWith('BRIEF\n'))
  for (const p of P.FOUNDATION_FILES) assert.ok(f.includes(p))
  const files = K.extractFileBlocks(FOUNDATION)
  const m = P.partMessage('BRIEF', files, part('detail'))
  assert.ok(m.startsWith('BRIEF\n') && m.includes('ProductDetailPage.tsx') && m.includes('export const products = []'))
  assert.ok(!m.includes('<file path='), 'foundation is not quoted as file blocks the writer could echo')
})

test('merge: complete blocks first, open tails last — several files open at once', () => {
  const parts = P.PARALLEL_PARTS.map((p) => ({ part: p, raw: '' }))
  parts[0].raw = `${file('components/store/HomePage.tsx', 'home')}`
  parts[1].raw = '<file path="components/store/ProductDetailPage.tsx">\nhalf'
  parts[2].raw = '<file path="components/store/CollectionPage.tsx">\nstart'
  parts[3].raw = `${file('data/config.ts', 'ECHO')}\n<file path="components/store/AboutPage.tsx">\nabout`
  const raw = P.mergeParallelOutput(FOUNDATION, parts)
  const files = K.extractFileBlocks(raw)
  assert.deepEqual(Object.keys(files).sort(), ['components/store/HomePage.tsx', 'data/config.ts', 'data/products.ts', 'styles/store.css'])
  assert.equal(files['data/config.ts'], 'export const config = {}', 'a writer can never overwrite the foundation')
  assert.ok(raw.includes('<summary>Coffee store'))
  const prog = B.fileProgress(raw)
  assert.deepEqual(prog.writingAll, ['components/store/ProductDetailPage.tsx', 'components/store/CollectionPage.tsx', 'components/store/AboutPage.tsx'])
  const states = new Map(B.buildParts(prog.done, prog.writingAll).map((p) => [p.id, p.state]))
  assert.equal(states.get('detail'), 'building')
  assert.equal(states.get('collection'), 'building')
  assert.equal(states.get('story'), 'building')
  assert.equal(states.get('hero'), 'done')
})

test('merge while the foundation is still streaming', () => {
  const parts = P.PARALLEL_PARTS.map((p) => ({ part: p, raw: '' }))
  const raw = P.mergeParallelOutput('<summary>S</summary>\n<file path="data/config.ts">\nexport', parts)
  assert.deepEqual(B.fileProgress(raw).writingAll, ['data/config.ts'])
  assert.deepEqual(K.extractFileBlocks(raw), {})
  assert.ok(P.foundationComplete(K.extractFileBlocks(FOUNDATION)))
  assert.ok(!P.foundationComplete({ 'data/config.ts': 'x' }))
})

test('wiring: only /qgent asks for it, batch stays one stream, routes never import the streamer', () => {
  assert.match(src('app/qgent/QgentSwarmClient.tsx'), /parallel: true/)
  assert.match(src('app/api/quante/generate/route.ts'), /rawParallel === true/)
  assert.doesNotMatch(src('lib/generation/batch.ts'), /parallel:/)
  assert.match(src('lib/generation/run.ts'), /runParallelGeneration\(/)
  assert.match(src('app/api/quante/generate/status/route.ts'), /writingAll/)
})
