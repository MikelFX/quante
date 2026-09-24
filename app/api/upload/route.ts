import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { detectImage } from './_lib/detect-image'
import { reserveUpload } from './_lib/quota'

export const maxDuration = 30

// SECURITY: store-assets is a PUBLIC bucket. Only raster images are accepted, the
// type is detected from magic bytes (never file.name / file.type), and the extension
// + Content-Type are chosen server-side — so the bucket can't be used to host HTML,
// SVG-with-script, executables, etc. under the platform's storage domain.
const MAX_BYTES = 8 * 1024 * 1024
const BUCKET = 'store-assets'

// SECURITY (audit F6): per-user daily cap, DB-backed so it holds across serverless
// instances (the in-memory rateLimit below is per instance only). Generous for real
// catalog work, but stops the public bucket being used as free image hosting.
const DAILY_QUOTA = { maxFiles: 200, maxBytes: 500 * 1024 * 1024 }

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cheap early reject before buffering a huge multipart body.
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'File too large (max 8 MB).' }, { status: 413 })
  }

  const rl = rateLimit(`upload:${userId}`, 30, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many uploads. Try again in a minute.' }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }
  const file = formData.get('file')
  const projectId = formData.get('projectId')

  if (!(file instanceof File) || typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ error: 'file and projectId required' }, { status: 400 })
  }

  const project = await getOwnedProject(projectId, userId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 8 MB).' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 8 MB).' }, { status: 413 })
  }

  const kind = detectImage(buffer)
  if (!kind) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a PNG, JPEG, WebP, GIF or AVIF image.' },
      { status: 415 },
    )
  }

  // Reserve against the daily quota before writing. Fallback while the upload_events
  // migration hasn't run: count today's objects across ALL of the user's project folders
  // (a per-project count would reset the cap for every new project).
  const quota = await reserveUpload(userId, BUCKET, buffer.length, DAILY_QUOTA, userId)
  if (!quota.ok) return NextResponse.json({ error: quota.error }, { status: quota.status })

  // Server-chosen path: owner-prefixed, random name, extension from detected type.
  const path = `${userId}/${projectId}/${Date.now()}-${randomUUID()}.${kind.ext}`

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: kind.contentType, upsert: false })

  if (uploadErr) {
    console.error('[upload]', uploadErr)
    await quota.release()
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: urlData.publicUrl })
}
