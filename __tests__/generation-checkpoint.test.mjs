// Level 1 checkpointing — extractFileBlocks() / filesChanged() pure logic.
// Usage: node --test __tests__/generation-checkpoint.test.mjs
// Or via: npm run test:generation-checkpoint
//
// Inlines a plain-JS copy of lib/generation-checkpoint.ts (must stay in sync) — same
// convention as __tests__/store-health.test.mjs / __tests__/fulfillment-byrd.test.mjs,
// since these tests run via plain `node --test` without a TypeScript loader.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// ─── lib/generation-checkpoint.ts (inlined copy) ────────────────────────────────

const FILE_BLOCK_RE = /<file path="([^"]+)">([\s\S]*?)<\/file>/g

function extractFileBlocks(raw) {
  const files = {}
  const re = new RegExp(FILE_BLOCK_RE)
  let match
  while ((match = re.exec(raw)) !== null) {
    files[match[1].trim()] = match[2].replace(/^\n/, '').replace(/\n$/, '')
  }
  return files
}

function filesChanged(previous, next) {
  const prevKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (prevKeys.length !== nextKeys.length) return true
  for (const key of nextKeys) {
    if (previous[key] !== next[key]) return true
  }
  return false
}

// ─── tests ───────────────────────────────────────────────────────────────────────

test('extractFileBlocks: empty string yields no files', () => {
  assert.deepEqual(extractFileBlocks(''), {})
})

test('extractFileBlocks: single complete file', () => {
  const raw = '<file path="data/config.ts">\nexport const x = 1\n</file>'
  assert.deepEqual(extractFileBlocks(raw), { 'data/config.ts': 'export const x = 1' })
})

test('extractFileBlocks: multiple complete files, in document order', () => {
  const raw = [
    '<summary>Store generated.</summary>',
    '<file path="data/config.ts">\nA\n</file>',
    '<file path="data/products.ts">\nB\n</file>',
  ].join('\n')
  assert.deepEqual(extractFileBlocks(raw), {
    'data/config.ts': 'A',
    'data/products.ts': 'B',
  })
})

test('extractFileBlocks: trailing incomplete file block is silently omitted, not an error', () => {
  // Simulates mid-stream state: one file finished, the model is still writing the second.
  const raw = [
    '<file path="data/config.ts">\nA\n</file>',
    '<file path="components/store/HomePage.tsx">\nexport function HomePage() { return <div>partial',
  ].join('\n')
  const files = extractFileBlocks(raw)
  assert.deepEqual(files, { 'data/config.ts': 'A' })
  assert.equal('components/store/HomePage.tsx' in files, false)
})

test('extractFileBlocks: a file is only counted once it is closed — checkpointing before and after the closing tag differ', () => {
  const before = '<file path="data/config.ts">\nexport const x = 1'
  const after = before + '\n</file>'
  assert.deepEqual(extractFileBlocks(before), {})
  assert.deepEqual(extractFileBlocks(after), { 'data/config.ts': 'export const x = 1' })
})

test('extractFileBlocks: repeated calls on a growing string are stateless (no shared regex lastIndex bug)', () => {
  const chunk1 = '<file path="a.ts">\none\n</file>'
  const chunk2 = chunk1 + '\n<file path="b.ts">\ntwo\n</file>'
  // Calling extractFileBlocks(chunk1) then extractFileBlocks(chunk2) must find BOTH files
  // on the second call — a stateful/reused RegExp with the `g` flag would silently miss
  // matches here if lastIndex carried over between calls on different strings.
  const first = extractFileBlocks(chunk1)
  const second = extractFileBlocks(chunk2)
  assert.deepEqual(first, { 'a.ts': 'one' })
  assert.deepEqual(second, { 'a.ts': 'one', 'b.ts': 'two' })
})

test('extractFileBlocks: strips exactly one leading and one trailing newline, preserves internal blank lines', () => {
  const raw = '<file path="x.ts">\n\nline1\n\nline2\n</file>'
  assert.deepEqual(extractFileBlocks(raw), { 'x.ts': '\nline1\n\nline2' })
})

test('filesChanged: identical empty objects → false', () => {
  assert.equal(filesChanged({}, {}), false)
})

test('filesChanged: new file appears → true', () => {
  assert.equal(filesChanged({}, { 'a.ts': 'x' }), true)
})

test('filesChanged: same keys, same content → false', () => {
  assert.equal(filesChanged({ 'a.ts': 'x' }, { 'a.ts': 'x' }), false)
})

test('filesChanged: same keys, different content (file still being appended to, not yet re-closed differently) → true', () => {
  assert.equal(filesChanged({ 'a.ts': 'x' }, { 'a.ts': 'x2' }), true)
})

test('filesChanged: same file count but different key → true', () => {
  assert.equal(filesChanged({ 'a.ts': 'x' }, { 'b.ts': 'x' }), true)
})
