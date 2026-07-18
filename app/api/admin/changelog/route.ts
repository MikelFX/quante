// POST   /api/admin/changelog  — create a changelog entry
// DELETE /api/admin/changelog  — delete an entry by id
// Gated to ADMIN_EMAILS (same check as the /admin page).

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

async function requireAdmin() {
  const { userId } = await auth()
  if (!userId) return null
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? ''
  return ADMIN_EMAILS.includes(email) ? userId : null
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const date = typeof body.date === 'string' ? body.date : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().toLowerCase())
    : []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !description) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD), title and description are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('changelog_entries')
    .insert({ date, title, description, tags })
    .select('id, date, title, description, tags')
    .single()

  if (error) {
    console.error('[admin/changelog] insert failed:', error)
    return NextResponse.json({ error: 'Insert failed — did you run migration-changelog.sql?' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, entry: data })
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('changelog_entries').delete().eq('id', body.id)
  if (error) {
    console.error('[admin/changelog] delete failed:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
