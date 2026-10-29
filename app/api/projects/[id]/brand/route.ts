// GET / PUT /api/projects/[id]/brand — the store's brand kit (logo, photos, texts; lib/brand-kit).
// Owner only. PUT replaces the whole kit after normalizeKit: every image must already be in the
// owner's own store-assets folder (uploaded through /api/upload), texts are trimmed plain text.
// Free — nothing here spends credits. Without supabase/migration-brand-kit.sql: GET answers an
// empty kit with ready: false, PUT answers 503.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeKit } from '@/lib/brand-kit/model'
import { assetsBase, getBrandKit, saveBrandKit } from '@/lib/brand-kit/store'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { kit, ready } = await getBrandKit(project.id, userId)
  return NextResponse.json({ kit, ready })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!rateLimit(`brand-kit:${userId}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many changes. Try again in a minute.' }, { status: 429 })
  }
  const body = await request.json().catch(() => null)
  const parsed = normalizeKit((body as { kit?: unknown } | null)?.kit, userId, assetsBase())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const saved = await saveBrandKit(project.id, userId, parsed.kit)
  if (!saved.ok) {
    return saved.missing
      ? NextResponse.json({ error: 'The brand kit is not set up yet.' }, { status: 503 })
      : NextResponse.json({ error: 'Could not save.' }, { status: 500 })
  }
  return NextResponse.json({ kit: parsed.kit })
}
