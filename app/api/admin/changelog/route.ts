// POST   /api/admin/changelog          create an entry
// PATCH  /api/admin/changelog          update an entry (id in body)
// DELETE /api/admin/changelog?id=<uuid> delete an entry (id in query, not body — some CDNs drop DELETE bodies)
// All gated to ADMIN_EMAILS. All mutations call revalidatePath('/changelog').

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { CHANGELOG_TAGS, slugify, type ChangelogTag } from '@/lib/changelog'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

async function requireAdmin() {
  const { userId } = await auth()
  if (!userId) return null
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? ''
  return ADMIN_EMAILS.includes(email) ? userId : null
}

const SELECT = 'id, date, title, description, tags, slug, updated_at, published, deployment_id'

type ValidatedFields = {
  date: string
  title: string
  description: string
  tags: ChangelogTag[]
  slug: string
}

function validate(body: Record<string, unknown>, requireAll: boolean): ValidatedFields | { error: string } {
  const date = typeof body.date === 'string' ? body.date : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const rawTags = Array.isArray(body.tags) ? body.tags : []

  if (requireAll || date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' }
    // reject impossible dates like 2026-02-30 which the regex allows
    const [y, m, d] = date.split('-').map(Number)
    const parsed = new Date(Date.UTC(y, m - 1, d))
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
      return { error: 'date is not a real calendar date' }
    }
  }
  if ((requireAll || 'title' in body) && !title) return { error: 'title is required' }
  if ((requireAll || 'description' in body) && !description) return { error: 'description is required' }

  const normalizedTags: ChangelogTag[] = []
  for (const t of rawTags) {
    if (typeof t !== 'string') continue
    const lower = t.trim().toLowerCase()
    if (!lower) continue
    if (!(CHANGELOG_TAGS as readonly string[]).includes(lower)) {
      return { error: `unknown tag "${lower}". Allowed: ${CHANGELOG_TAGS.join(', ')}` }
    }
    if (!normalizedTags.includes(lower as ChangelogTag)) normalizedTags.push(lower as ChangelogTag)
  }

  return {
    date,
    title,
    description,
    tags: normalizedTags,
    slug: title ? slugify(title) : '',
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const v = validate(body, true)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .insert({ date: v.date, title: v.title, description: v.description, tags: v.tags, slug: v.slug })
    .select(SELECT)
    .single()

  if (error) {
    console.error('[admin/changelog] insert failed:', error)
    return NextResponse.json({
      error: `Insert failed: ${error.message}. Run supabase/migration-changelog.sql (and migration-changelog-v2.sql for slug/updated_at) if the table is missing.`,
    }, { status: 500 })
  }

  revalidatePath('/changelog')
  return NextResponse.json({ ok: true, entry: data })
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const v = validate(body, true)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })

  // `published` is optional and only touched when explicitly sent — this is
  // what the "Publish" button in ChangelogAdmin.tsx uses (V3 draft review
  // flow): it PATCHes the entry's existing fields plus `published: true`,
  // without needing its own separate endpoint or validation path.
  const update: Record<string, unknown> = {
    date: v.date, title: v.title, description: v.description, tags: v.tags, slug: v.slug,
  }
  if (typeof body.published === 'boolean') update.published = body.published

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .update(update)
    .eq('id', id)
    .select(SELECT)
    .single()

  if (error) {
    console.error('[admin/changelog] update failed:', error)
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 })
  }

  revalidatePath('/changelog')
  return NextResponse.json({ ok: true, entry: data })
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.trim() ?? ''
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('changelog_entries').delete().eq('id', id)
  if (error) {
    console.error('[admin/changelog] delete failed:', error)
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 })
  }

  revalidatePath('/changelog')
  return NextResponse.json({ ok: true })
}
