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

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB — well above a phone camera photo, well below Vercel's 15 MB body cap
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  if (!ALLOWED_MIMES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported content-type: ${file.type}` }, { status: 415 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }

  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const arrayBuffer = await file.arrayBuffer()

  const { error: uploadError } = await supabaseAdmin.storage
    .from('qads-inputs')
    .upload(storagePath, Buffer.from(arrayBuffer), {
      contentType: file.type,
      upsert: false,
    })
  if (uploadError) {
    console.error('[qads/upload] storage upload failed:', uploadError.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  // Sign a short-lived URL Higgsfield can fetch. 2 hours is plenty for a
  // batch of concurrent submits to complete their initial fetch — after
  // that Higgsfield has the pixels and no longer needs the reference URL.
  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from('qads-inputs')
    .createSignedUrl(storagePath, 60 * 60 * 2)
  if (signError || !signed?.signedUrl) {
    console.error('[qads/upload] signed URL failed:', signError?.message)
    return NextResponse.json({ error: 'Failed to sign uploaded file' }, { status: 500 })
  }

  return NextResponse.json({
    storagePath,
    signedUrl: signed.signedUrl,
    mimeType: file.type,
    bytes: file.size,
  })
}
