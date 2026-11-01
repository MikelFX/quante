// The Qads community library is opt-in and only ever shows finished outputs: pins the rules in
// lib/qads/community.ts, the generate route, the share toggle and the /qads client.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
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

// Light previews (lib/qads/community-preview*.ts): the wall never loads the multi-megabyte originals
// once a preview exists — that is what made it stutter on phones (2026-11-01).
const spec = await import('../lib/qads/community-preview-spec.ts')

test('preview paths only come from item ids, inside the preview folder', () => {
  assert.equal(spec.stillPath('3f2a9c1e-0b7d-4e55-9a1f-2c6b8d7e9f00'), 'community-preview/still/3f2a9c1e-0b7d-4e55-9a1f-2c6b8d7e9f00.webp')
  assert.equal(spec.clipPath('3f2a9c1e-0b7d-4e55-9a1f-2c6b8d7e9f00'), 'community-preview/clip/3f2a9c1e-0b7d-4e55-9a1f-2c6b8d7e9f00.mp4')
  assert.equal(spec.stillPath('../x'), null)
  assert.equal(spec.clipPath('a/b'), null)
})

test('a row uses its preview when it exists and is queued when it does not', () => {
  const id = '3f2a9c1e-0b7d-4e55-9a1f-2c6b8d7e9f00'
  const still = spec.stillPath(id)
  const clip = spec.clipPath(id)
  assert.deepEqual(spec.previewPlan({ id, kind: 'image' }, new Set([still]), new Set()), { still, clip: null, missing: false })
  assert.deepEqual(spec.previewPlan({ id, kind: 'image' }, new Set(), new Set()), { still: null, clip: null, missing: true })
  // a video needs both: the poster and the light loop
  assert.equal(spec.previewPlan({ id, kind: 'video' }, new Set([still]), new Set()).missing, true)
  assert.deepEqual(spec.previewPlan({ id, kind: 'video' }, new Set([still]), new Set([clip])), { still, clip, missing: false })
})

test('previews are small: a few hundred px, silent short loops, played straight away', () => {
  assert.ok(spec.STILL_W <= 720 && spec.CLIP_W <= 540)
  const clip = spec.clipArgs('in', 'out.mp4')
  assert.ok(clip.includes('-an'), 'no audio')
  assert.ok(clip.includes('+faststart'))
  assert.equal(clip[clip.indexOf('-t') + 1], String(spec.CLIP_SECONDS))
  assert.ok(spec.stillArgs('in', 'out.webp', 'image').includes('libwebp'))
})

test('the wall is served the previews, built after the response, never a URL to ffmpeg', () => {
  const lib = src('lib/qads/community.ts')
  assert.match(lib, /src: kind === 'video' \? \(clip \?\? original\) : \(still \?\? original\)/)
  assert.match(src('app/api/qads/community/route.ts'), /after\(\(\) => buildCommunityPreviews\(missing\)\)/)
  const build = src('lib/qads/community-preview.ts')
  assert.match(build, /\.download\(row\.path\)/)
  assert.match(build, /writeFile\(input/)
})

test('the seed videos on the wall are light loops too', () => {
  for (const f of ['video-keyboard.mp4', 'video-wheel.mp4']) assert.ok(statSync(ROOT + 'public/qads/community/' + f).size < 400_000, f)
})
