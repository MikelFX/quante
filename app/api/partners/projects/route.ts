// POST   /api/partners/projects   { projectId }  — assign one of your own projects to your own partner account
// DELETE /api/partners/projects?projectId=...    — unassign it again
//
// ASSIGNMENT MODEL (explicit design decision, flagged for the user to revisit if the real
// business model differs): a partner can only assign PROJECTS THEY OWN THEMSELVES. This
// matches "an agency builds a client's store inside their own Quante account" — the agency
// is both the project owner and the partner earning commission on it. It does NOT support
// a model where a partner refers a separate, independently-owned client account (that
// would need consent/invitation flow from the client's side, which was out of scope for
// this pass — the `referral_code` column on `partners` is reserved for exactly that, but
// no signup-flow wiring exists yet). See docs/update-log.md.

import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function getOwnPartner(userId: string) {
  const { data } = await supabaseAdmin
    .from('partners')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const projectId = typeof body.projectId === 'string' ? body.projectId : null
  if (!projectId) return Response.json({ error: 'projectId is required' }, { status: 400 })

  const partner = await getOwnPartner(userId)
  if (!partner) return Response.json({ error: 'You do not have a partner account yet' }, { status: 404 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('partner_projects')
    .upsert(
      { partner_id: partner.id, project_id: projectId, status: 'active', assigned_at: new Date().toISOString() },
      { onConflict: 'project_id' }
    )
    .select('id, project_id, status, assigned_at')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ assignment: data }, { status: 201 })
}

export async function DELETE(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return Response.json({ error: 'projectId is required' }, { status: 400 })

  const partner = await getOwnPartner(userId)
  if (!partner) return Response.json({ error: 'You do not have a partner account yet' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('partner_projects')
    .update({ status: 'removed' })
    .eq('partner_id', partner.id)
    .eq('project_id', projectId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
