// Builds the community wall's light previews (rules + sizes in ./community-preview-spec.ts).
// Server-only. Runs after the response of GET /api/qads/community (next/server `after`), a few
// items per call, so the first visitors after a share still get the original and everyone after
// gets the preview. Uses the static ffmpeg build from `ffmpeg-static` on a temp file (the static
// binary cannot resolve hosts itself, and we never hand it a URL anyway). Any failure only logs:
// the wall then keeps showing the original, exactly as before.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { CLIP_DIR, STILL_DIR, clipArgs, clipPath, stillArgs, stillPath, type PreviewRow } from './community-preview-spec'

const BUCKET = 'qads-outputs'
const PER_CALL = 6
const FFMPEG_TIMEOUT_MS = 60_000
const building = new Set<string>()
// A file that failed is not retried by this instance for a while, so it never blocks the queue.
const failedAt = new Map<string, number>()
const RETRY_AFTER_MS = 6 * 3600_000

/** Paths of the previews that exist, by folder (one list call each). */
export async function existingPreviews(): Promise<{ stills: Set<string>; clips: Set<string> }> {
  const list = async (dir: string) => {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(dir, { limit: 1000 })
    if (error) return new Set<string>()
    return new Set((data ?? []).filter((f) => f.id).map((f) => `${dir}/${f.name}`))
  }
  const [stills, clips] = await Promise.all([list(STILL_DIR), list(CLIP_DIR)])
  return { stills, clips }
}

async function ffmpegPath(): Promise<string | null> {
  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default?: string | null }
    return mod.default ?? null
  } catch {
    return null
  }
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile(bin, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err) => (err ? fail(err) : done()))
  })
}

async function upload(path: string, file: string, contentType: string) {
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, await readFile(file), {
    contentType,
    upsert: true,
    cacheControl: '31536000',
  })
  if (error) throw new Error(error.message)
}

async function buildOne(bin: string, row: PreviewRow & { bucket: string; path: string }) {
  const still = stillPath(row.id)
  if (!still) return
  const { data, error } = await supabaseAdmin.storage.from(row.bucket).download(row.path)
  if (error || !data) throw new Error(error?.message ?? 'download failed')
  const dir = await mkdtemp(join(tmpdir(), 'qads-preview-'))
  try {
    const input = join(dir, 'in')
    await writeFile(input, Buffer.from(await data.arrayBuffer()))
    const clip = row.kind === 'video' ? clipPath(row.id) : null
    // The clip first, the still last: the still's presence is what marks a photo as done.
    if (clip) {
      const out = join(dir, 'clip.mp4')
      await run(bin, clipArgs(input, out))
      await upload(clip, out, 'video/mp4')
    }
    const out = join(dir, 'still.webp')
    await run(bin, stillArgs(input, out, row.kind))
    await upload(still, out, 'image/webp')
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Build previews for up to a few rows that have none yet. Never throws. */
export async function buildCommunityPreviews(rows: (PreviewRow & { bucket: string; path: string })[]): Promise<void> {
  const now = Date.now()
  const todo = rows.filter((r) => !building.has(r.id) && !(now - (failedAt.get(r.id) ?? -Infinity) < RETRY_AFTER_MS)).slice(0, PER_CALL)
  if (!todo.length) return
  const bin = await ffmpegPath()
  if (!bin) {
    console.warn('[qads/community] no ffmpeg binary: previews skipped, the wall shows originals')
    return
  }
  for (const r of todo) building.add(r.id)
  try {
    for (const r of todo) {
      try {
        await buildOne(bin, r)
      } catch (e) {
        failedAt.set(r.id, Date.now())
        console.warn('[qads/community] preview failed for', r.id, (e as Error).message)
      }
    }
  } finally {
    for (const r of todo) building.delete(r.id)
  }
}
