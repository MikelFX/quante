// Copies a finished Higgsfield asset into the private qads-outputs bucket.
// Server-only. Shared by the webhook route and the sweep-stuck cron.
//
// Higgsfield URLs expire "at least seven days" per docs — we mirror every
// completed asset immediately so a download months later still works.
//
// SSRF guard: the server fetches this URL, so it must be an https URL on a
// Higgsfield-owned asset host (every redirect hop is re-checked), the response
// must be an allowlisted media type, and the body is size-capped. The URL now
// only ever comes from an authenticated Higgsfield status poll, never from a
// webhook body — the allowlist is defence in depth on top of that.

import { supabaseAdmin } from '@/lib/supabase/admin'

const OUTPUT_BUCKET = 'qads-outputs'
const MAX_ASSET_BYTES = 200 * 1024 * 1024 // a 10s 720p mp4 is ~10-30 MB; 200 MB is a hard ceiling
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 60_000

// Host suffixes Higgsfield serves generated media from. Extend without a code
// change via HIGGSFIELD_ASSET_HOSTS (comma-separated exact hosts or ".suffix").
const DEFAULT_ASSET_HOSTS = [
  '.higgsfield.ai',
  'higgsfield.ai',
  // Higgsfield's CloudFront distribution for generation outputs.
  'd8j0ntlcm91z4.cloudfront.net',
]

// mime → file extension. Anything not listed is rejected.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
}
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
}

function allowedHosts(): string[] {
  const extra = (process.env.HIGGSFIELD_ASSET_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
  return [...DEFAULT_ASSET_HOSTS, ...extra]
}

export function isAllowedAssetUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  if (u.port && u.port !== '443') return false
  const host = u.hostname.toLowerCase()
  return allowedHosts().some(h => (h.startsWith('.') ? host.endsWith(h) : host === h))
}

async function fetchAllowlisted(url: string): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedAssetUrl(current)) {
      throw new Error(`asset host not allowlisted: ${safeHost(current)} (set HIGGSFIELD_ASSET_HOSTS if this is a Higgsfield CDN)`)
    }
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`asset redirect without location (${res.status})`)
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new Error('too many asset redirects')
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname
  } catch {
    return 'invalid-url'
  }
}

function resolveMime(headerType: string | null, url: string): string | null {
  const base = (headerType ?? '').split(';')[0].trim().toLowerCase()
  if (MIME_EXT[base]) return base
  // Some CDNs serve binary/octet-stream — fall back to the URL's extension,
  // still restricted to the same allowlist.
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    return EXT_MIME[ext] ?? null
  } catch {
    return null
  }
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_ASSET_BYTES) throw new Error(`asset too large (${declared} bytes)`)
  if (!res.body) throw new Error('asset has no body')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_ASSET_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('asset exceeds size cap')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function copyAssetToStorage(params: {
  userId: string
  generationId: string
  itemId: string
  sourceUrl: string
}): Promise<{ bucket: string; path: string; mimeType: string }> {
  const { userId, generationId, itemId, sourceUrl } = params
  const res = await fetchAllowlisted(sourceUrl)
  if (!res.ok) throw new Error(`Failed to fetch generated asset: ${res.status}`)
  const mimeType = resolveMime(res.headers.get('content-type'), sourceUrl)
  if (!mimeType) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`unsupported asset content-type: ${res.headers.get('content-type') ?? 'none'}`)
  }
  const buffer = await readCapped(res)
  const ext = MIME_EXT[mimeType]
  // Path is built only from server-side ids + an allowlisted extension.
  const path = `${userId}/${generationId}/${itemId}.${ext}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(OUTPUT_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: true })
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  return { bucket: OUTPUT_BUCKET, path, mimeType }
}
