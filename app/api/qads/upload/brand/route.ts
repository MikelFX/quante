// POST /api/qads/upload/brand { projectId, url } — uses a photo from the store's brand kit as a Qads
// product photo. The photo must be in that store's kit (and so in the owner's own store-assets
// folder, lib/brand-kit/model.ts ownAssetPath); it is read from storage by its path — never fetched
// from a URL — copied into the private qads-inputs bucket and answered exactly like
// /api/qads/upload (storagePath + short-lived signed URL), so the generate route treats it like any
// other upload. Same type checks, rate limit and daily quota as a normal upload. Free.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { getOwnedProject } from '@/lib/auth/project'
import { detectImage } from '@/app/api/upload/_lib/detect-image'
import { reserveUpload } from '@/app/api/upload/_lib/quota'
import { INPUT_BUCKET, INPUT_DAILY_QUOTA } from '@/lib/qads/inputs'
import { ownAssetPath } from '@/lib/brand-kit/model'
import { assetsBase, getBrandKit } from '@/lib/brand-kit/store'

export const maxDuration = 30

const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`qads-upload:${userId}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many uploads. Try again in a minute.' }, { status: 429 })
  }
  const body = (await request.json().catch(() => null)) as { projectId?: unknown; url?: unknown } | null
  const project = await getOwnedProject<{ id: string }>(body?.projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { kit } = await getBrandKit(project.id, userId)
  const url = typeof body?.url === 'string' ? body.url : ''
  const inKit = kit.photos.includes(url) || kit.logoUrl === url
  const path = inKit ? ownAssetPath(url, userId, assetsBase()) : null
  if (!path) return NextResponse.json({ error: 'That photo is not in this brand kit.' }, { status: 404 })

  const { data: blob, error: readError } = await supabaseAdmin.storage.from('store-assets').download(path)
  if (readError || !blob) return NextResponse.json({ error: 'The photo could not be read.' }, { status: 404 })
  if (blob.size === 0 || blob.size > MAX_BYTES) {
    return NextResponse.json({ error: `The photo must be under ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 })
  }
  const buffer = Buffer.from(await blob.arrayBuffer())
  const kind = detectImage(buffer)
  if (!kind || !ALLOWED_MIMES.has(kind.contentType)) {
    return NextResponse.json({ error: 'Qads takes JPEG, PNG or WebP photos — this one is another type.' }, { status: 415 })
  }

  const quota = await reserveUpload(userId, INPUT_BUCKET, buffer.length, INPUT_DAILY_QUOTA, userId)
  if (!quota.ok) return NextResponse.json({ error: quota.error }, { status: quota.status })

  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${kind.ext}`
  const { error: uploadError } = await supabaseAdmin.storage
    .from(INPUT_BUCKET)
    .upload(storagePath, buffer, { contentType: kind.contentType, upsert: false })
  if (uploadError) {
    console.error('[qads/upload/brand] storage upload failed:', uploadError.message)
    await quota.release()
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
  const { data: signed, error: signError } = await supabaseAdmin.storage.from(INPUT_BUCKET).createSignedUrl(storagePath, 60 * 60 * 2)
  if (signError || !signed?.signedUrl) return NextResponse.json({ error: 'Failed to sign uploaded file' }, { status: 500 })

  return NextResponse.json({ storagePath, signedUrl: signed.signedUrl, mimeType: kind.contentType, bytes: buffer.length })
}
