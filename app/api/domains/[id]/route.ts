import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'

// Assigns an owned-but-unassigned domain (project_id IS NULL — e.g. bought from the
// general /domains marketing page without picking a store first) to a specific project.
// Added 2026-08-21 alongside the StudioClient "Your domains" scoping fix: before this,
// there was no way to attach a domain purchased without a project to one after the fact,
// so it just sat unassigned forever and — because of the display bug this fix pairs
// with — appeared to "leak" into every project's Publish panel instead. Only ever
// assigns a domain the caller already owns and that isn't already claimed elsewhere.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { projectId?: string }
  const projectId = body.projectId
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })

  const supabase = await createClient()

  // Verify the domain belongs to this user and isn't already attached elsewhere.
  const { data: domain } = await supabase
    .from('user_domains')
    .select('id, project_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 })
  if (domain.project_id && domain.project_id !== projectId) {
    return Response.json({ error: 'Domain is already connected to another store' }, { status: 409 })
  }

  // Verify the target project belongs to this user too.
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  const { error } = await supabase
    .from('user_domains')
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Verify ownership
  const { data: domain } = await supabase
    .from('user_domains')
    .select('id, domain')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 })

  // Soft delete — mark as expired
  await supabase
    .from('user_domains')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', id)

  return Response.json({ ok: true })
}
