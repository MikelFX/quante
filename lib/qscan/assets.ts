// Qscan: copies the scanned store's images (and short videos) into our public store-assets
// bucket, so the new store never hotlinks the old one — it keeps working after the merchant
// switches the old shop off. Server-only.
//
// SECURITY: store-assets is PUBLIC. Exactly like /api/upload, the file type comes from the bytes
// (detectImage / detectVideo), never from the remote Content-Type or file name, and the path is
// chosen here: <userId>/qscan-<scanId>/<n>.<ext>. Downloads go through scanFetch (SSRF guard).
// Every scan is bounded (QSCAN_LIMITS); the number of scans a day is capped in the route.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { detectImage } from '@/app/api/upload/_lib/detect-image'
import { scanFetch } from './fetch'
import type { ScanResult } from './extract'

const BUCKET = 'store-assets'

export const QSCAN_LIMITS = {
  images: 80,
  imageBytes: 10 * 1024 * 1024,
  videos: 2,
  videoBytes: 40 * 1024 * 1024,
  totalBytes: 160 * 1024 * 1024,
  concurrency: 6,
} as const

export function detectVideo(buf: Buffer): { ext: string; contentType: string } | null {
  if (buf.length < 12) return null
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis' || brand.startsWith('hei') || brand === 'mif1') return null
    return { ext: 'mp4', contentType: 'video/mp4' }
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', contentType: 'video/webm' }
  return null
}

export interface CopyReport {
  imagesFound: number
  imagesCopied: number
  videosFound: number
  videosCopied: number
  bytes: number
}

/**
 * Copies what the new store needs and returns the result with every image/video URL replaced by
 * our copy. Anything that could not be copied is dropped from the result.
 */
export async function copyScanAssets(userId: string, scanId: string, scan: ScanResult, deadline: number): Promise<{ result: ScanResult; report: CopyReport }> {
  // Order = importance: logo, each product's main photo, site images, more product photos.
  const wanted: string[] = []
  const push = (u: string | null | undefined) => { if (u && !wanted.includes(u)) wanted.push(u) }
  push(scan.brand.logo)
  for (const p of scan.products) push(p.images[0])
  for (const i of scan.images.slice(0, 16)) push(i.src)
  for (const p of scan.products) push(p.images[1])
  for (const p of scan.products) push(p.images[2])
  for (const p of scan.products) push(p.images[3])
  const images = wanted.slice(0, QSCAN_LIMITS.images)
  const videos = scan.videos.filter((v) => /\.(mp4|webm|m4v)(\?|$)/i.test(v)).slice(0, QSCAN_LIMITS.videos)

  const map = new Map<string, string>()
  let bytes = 0
  let n = 0

  const copyOne = async (src: string, kind: 'image' | 'video') => {
    if (Date.now() > deadline || bytes >= QSCAN_LIMITS.totalBytes) return
    try {
      const max = kind === 'image' ? QSCAN_LIMITS.imageBytes : QSCAN_LIMITS.videoBytes
      const res = await scanFetch(src, { maxBytes: max, timeoutMs: kind === 'image' ? 12_000 : 30_000, accept: kind === 'image' ? 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' : 'video/mp4,video/webm,video/*;q=0.8' })
      if (res.status !== 200) return
      const type = kind === 'image' ? detectImage(res.body) : detectVideo(res.body)
      if (!type) return
      if (bytes + res.body.length > QSCAN_LIMITS.totalBytes) return
      bytes += res.body.length
      const path = `${userId}/qscan-${scanId}/${String(++n).padStart(3, '0')}.${type.ext}`
      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, res.body, { contentType: type.contentType, upsert: false })
      if (error) {
        bytes -= res.body.length
        console.warn(`[qscan] upload failed (${kind}):`, error.message)
        return
      }
      map.set(src, supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch {
      // unreachable / too large / not an image — skipped
    }
  }

  const jobs: Array<[string, 'image' | 'video']> = [...images.map((u) => [u, 'image'] as [string, 'image']), ...videos.map((u) => [u, 'video'] as [string, 'video'])]
  let i = 0
  await Promise.all(Array.from({ length: QSCAN_LIMITS.concurrency }, async () => {
    while (i < jobs.length && Date.now() < deadline) {
      const [u, k] = jobs[i++]
      await copyOne(u, k)
    }
  }))

  const ours = (u: string | null | undefined) => (u ? map.get(u) ?? null : null)
  const result: ScanResult = {
    ...scan,
    brand: { ...scan.brand, logo: ours(scan.brand.logo) },
    products: scan.products.map((p) => ({ ...p, images: p.images.map((u) => ours(u)).filter((u): u is string => !!u) })),
    images: scan.images.map((img) => ({ ...img, src: ours(img.src) ?? '' })).filter((img) => img.src),
    videos: videos.map((v) => ours(v)).filter((v): v is string => !!v),
  }
  const totalImages = new Set([scan.brand.logo, ...scan.images.map((x) => x.src), ...scan.products.flatMap((p) => p.images)].filter(Boolean)).size
  return {
    result,
    report: {
      imagesFound: totalImages,
      imagesCopied: [...map.keys()].filter((k) => !videos.includes(k)).length,
      videosFound: scan.videos.length,
      videosCopied: result.videos.length,
      bytes,
    },
  }
}
