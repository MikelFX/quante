// POST /api/qads/upload — accepts a single product photo, stores it in the
// privátní qads-inputs Supabase bucket keyed by user, and returns a short-
// lived signed URL the /qads generator form can hand to Higgsfield as
// image_urls[]. The uploader supports 1–4 photos per generation; the client
// hits this endpoint once per photo rather than a single multi-file request
// so a slow upload doesn't block the whole batch.
//
// Auth required — unauthenticated visitors can *see* the /qads form but
// uploads only succeed once they've signed in (session state on the client
// keeps the picked File objects around across the auth redirect).
//
// SECURITY (audit F6/F11): the image type is detected from magic bytes (the client's
// multipart Content-Type is never trusted) and the stored extension + Content-Type
// come from that detection, so the bucket can't hold arbitrary files labelled as
// images. Uploads are rate limited per user (in-memory, per instance) and capped per
// user per day by a DB-backed quota (app/api/upload/_lib/quota.ts).

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { detectImage } from '@/app/api/upload/_lib/detect-image'
import { reserveUpload } from '@/app/api/upload/_lib/quota'

export const maxDuration = 30

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB — well above a phone camera photo, well below Vercel's 15 MB body cap
// Formats Higgsfield accepts as reference images (checked against the DETECTED type).
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const BUCKET = 'qads-inputs'
// 1–4 photos per generation; a busy day of ad work stays well under this.
const DAILY_QUOTA = { maxFiles: 60, maxBytes: 300 * 1024 * 1024 }

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cheap early reject before buffering a huge multipart body.
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }

  const rl = rateLimit(`qads-upload:${userId}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many uploads. Try again in a minute.' }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 })
  }

  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }

  const kind = detectImage(buffer)
  if (!kind || !ALLOWED_MIMES.has(kind.contentType)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a JPEG, PNG or WebP image.' },
      { status: 415 },
    )
  }

  // Daily quota, reserved before writing. Fallback while the upload_events migration
  // hasn't run: count today's objects under the user's folder in the bucket.
  const quota = await reserveUpload(userId, BUCKET, buffer.length, DAILY_QUOTA, userId)
  if (!quota.ok) return NextResponse.json({ error: quota.error }, { status: quota.status })

  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${kind.ext}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: kind.contentType,
      upsert: false,
    })
  if (uploadError) {
    console.error('[qads/upload] storage upload failed:', uploadError.message)
    await quota.release()
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  // Sign a short-lived URL Higgsfield can fetch. 2 hours is plenty for a
  // batch of concurrent submits to complete their initial fetch — after
  // that Higgsfield has the pixels and no longer needs the reference URL.
  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 2)
  if (signError || !signed?.signedUrl) {
    console.error('[qads/upload] signed URL failed:', signError?.message)
    return NextResponse.json({ error: 'Failed to sign uploaded file' }, { status: 500 })
  }

  return NextResponse.json({
    storagePath,
    signedUrl: signed.signedUrl,
    mimeType: kind.contentType,
    bytes: buffer.length,
  })
}
