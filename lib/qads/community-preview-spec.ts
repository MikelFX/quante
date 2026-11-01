// Light previews for the Qads community wall (pure: paths, ffmpeg arguments, which rows have one).
// The wall's tiles are at most 230 CSS px wide, but shared outputs are what Higgsfield delivered:
// 4-megapixel PNGs of ~5 MB and 720p videos at ~10 Mbit/s, 12–20 MB each. A phone fetching and
// decoding a dozen of those inside a moving 3D scene stutters however lean the script is (measured
// 2026-11-01 on the live wall). So every shared item gets, once, in the same private bucket:
//   still: a small WebP — the picture itself for photos, the first frame (poster) for videos
//   clip:  for videos, a short, silent, small H.264 loop (≈200 KB instead of ≈20 MB)
// Built by lib/qads/community-preview.ts; the originals are never changed and stay the download.

export const PREVIEW_ROOT = 'community-preview'
export const STILL_DIR = `${PREVIEW_ROOT}/still`
export const CLIP_DIR = `${PREVIEW_ROOT}/clip`

/** Tile ≤ 230 CSS px wide × up to 3 device px: 540 px keeps photos sharp on any phone. */
export const STILL_W = 540
/** Videos move or sit under a scrim; 432 px is plenty and keeps the clip tiny. */
export const CLIP_W = 432
/** The wall loops a clip; a few seconds is enough and keeps the file small. */
export const CLIP_SECONDS = 8

// Item ids are uuids; anything else never becomes a storage path.
const SAFE_ID = /^[0-9a-f-]{8,64}$/i

export function stillPath(itemId: string): string | null {
  return SAFE_ID.test(itemId) ? `${STILL_DIR}/${itemId}.webp` : null
}
export function clipPath(itemId: string): string | null {
  return SAFE_ID.test(itemId) ? `${CLIP_DIR}/${itemId}.mp4` : null
}

/** ffmpeg arguments for the still (photo → small WebP, video → its first frame as a WebP). */
export function stillArgs(input: string, output: string, kind: 'image' | 'video'): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...(kind === 'video' ? ['-ss', '0.3'] : []),
    '-i', input,
    '-frames:v', '1',
    '-vf', `scale=w='min(${STILL_W},iw)':h=-2`,
    '-c:v', 'libwebp', '-quality', '74',
    output,
  ]
}

/** ffmpeg arguments for the clip: no audio, 24 fps, H.264 main profile, moov first (plays at once). */
export function clipArgs(input: string, output: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-t', String(CLIP_SECONDS),
    '-i', input,
    '-an',
    '-vf', `scale=w='min(${CLIP_W},iw)':h=-2,fps=24`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-crf', '28', '-maxrate', '900k', '-bufsize', '1800k',
    '-movflags', '+faststart',
    output,
  ]
}

export interface PreviewRow { id: string; kind: 'image' | 'video' }

/** Which preview files a row should use, given what exists in storage; `missing` = still to build. */
export function previewPlan(row: PreviewRow, stills: Set<string>, clips: Set<string>): { still: string | null; clip: string | null; missing: boolean } {
  const s = stillPath(row.id)
  const c = row.kind === 'video' ? clipPath(row.id) : null
  const still = s && stills.has(s) ? s : null
  const clip = c && clips.has(c) ? c : null
  const missing = !!s && (!still || (row.kind === 'video' && !clip))
  return { still, clip, missing }
}
