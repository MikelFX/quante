// The Qads community library is opt-in and only ever shows finished outputs: pins the rules in
// lib/qads/community.ts, the generate route, the share toggle and the /qads client.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = (p) => readFileSync(ROOT + p, 'utf8')

test('the wall lists only shared, finished, not-hidden outputs', () => {
  const lib = src('lib/qads/community.ts')
  assert.match(lib, /\.eq\('status', 'completed'\)/)
  assert.match(lib, /\.eq\('community_hidden', false\)/)
  assert.match(lib, /\.eq\('qads_generations\.share_community', true\)/)
  assert.match(lib, /createSignedUrls\(/, 'private bucket, short-lived URLs')
  assert.doesNotMatch(lib, /input_photo/, 'uploaded product photos are never listed')
})

test('sharing is off unless the user says yes', () => {
  assert.match(src('app/api/qads/generate/route.ts'), /shareCommunity: z\.boolean\(\)\.optional\(\)\.default\(false\)/)
  assert.match(src('supabase/migration-qads-community.sql'), /share_community boolean NOT NULL DEFAULT false/)
})

test('Generate always asks before starting', () => {
  const c = src('app/qads/QadsGeneratorClient.tsx')
  assert.match(c, /const handleSubmit = \(\) => \{[\s\S]*?setAskShare\(true\)/)
  assert.match(c, /const startGeneration = async \(shareCommunity: boolean\)/)
  assert.match(c, /shareCommunity,\r?\n\s*\}\),/)
})

test('only the owner can change sharing', () => {
  assert.match(src('app/api/qads/generations/[id]/share/route.ts'), /\.eq\('id', id\)\.eq\('user_id', userId\)/)
})
