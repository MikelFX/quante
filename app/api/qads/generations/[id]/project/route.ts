// PATCH /api/qads/generations/[id]/project { projectId } — assigns a Qads generation made without
// a store to one of the owner's stores, so the Dashboard shows it under that brand. Both the
// generation and the store must belong to the signed-in user. Only metadata changes: nothing is
// regenerated and nothing is charged.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { projectId?: unknown } | null
  if (!isUuid(id) || !isUuid(body?.projectId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await getOwnedProject<{ id: string }>(body.projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('qads_generations')
    .update({ project_id: project.id })
    .eq('id', id).eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
