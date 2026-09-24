import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { attachDomain } from '@/lib/hosting/vercel'
import { type DomainRow, isQuanteRegistered, releaseDomainRow } from '../_lib/release'

// Assigns an owned-but-unassigned domain (project_id IS NULL — e.g. bought from the
// general /domains marketing page without picking a store first) to a specific project.
// Added 2026-08-21 alongside the StudioClient "Your domains" scoping fix: before this,
// there was no way to attach a domain purchased without a project to one after the fact,
// so it just sat unassigned forever and — because of the display bug this fix pairs
// with — appeared to "leak" into every project's Publish panel instead. Only ever
// assigns a domain the caller already owns and that isn't already claimed elsewhere.
//
// SECURITY: the domain is also attached (apex + www) to the target project's Vercel
// project here. A Quante-registered domain already has DNS pointed at Vercel, so
// leaving it unattached meant the first project in the shared team to claim it got it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { projectId?: unknown }
  const projectId = body.projectId
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })

  // Verify the domain belongs to this user and isn't already attached elsewhere.
  const { data: domain } = await supabaseAdmin
    .from('user_domains')
    .select('id, domain, project_id, status')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 })
  if (domain.project_id && domain.project_id !== projectId) {
    return Response.json({ error: 'Domain is already connected to another store' }, { status: 409 })
  }
  // A failed / refunded / expired / payment-disputed purchase is not a domain the user holds.
  if (['failed', 'failed_refunded', 'expired', 'disputed'].includes(domain.status as string)) {
    return Response.json({ error: 'This domain is not active' }, { status: 409 })
  }

  // Verify the target project belongs to this user too.
  const project = await getOwnedProject<{ id: string; vercel_project_id: string | null }>(
    projectId,
    userId,
    'id, vercel_project_id',
  )
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })

  let vercelProjectId: string | null = null
  if (project.vercel_project_id) {
    try {
      await attachDomain(project.vercel_project_id, domain.domain as string)
      vercelProjectId = project.vercel_project_id
    } catch (err) {
      console.error('[domains/[id]] attachDomain failed:', err)
      return Response.json({ error: 'Failed to attach domain to hosting' }, { status: 502 })
    }
    // www variant is non-critical — Vercel redirects it to the apex
    try { await attachDomain(project.vercel_project_id, `www.${domain.domain}`) } catch { /* non-fatal */ }
  }

  // Compare-and-set: only assign if it's still unassigned (or already ours).
  let update = supabaseAdmin
    .from('user_domains')
    .update({
      project_id: project.id,
      ...(vercelProjectId ? { vercel_project_id: vercelProjectId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
  update = domain.project_id ? update.eq('project_id', project.id) : update.is('project_id', null)
  const { data: updated, error } = await update.select('id')

  if (error) {
    console.error('[domains/[id]] update failed:', error.message)
    return Response.json({ error: 'Could not assign domain' }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return Response.json({ error: 'Domain is already connected to another store' }, { status: 409 })
  }
  return Response.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  // Verify ownership (select('*') so optional columns never break the query)
  const { data } = await supabaseAdmin
    .from('user_domains')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  const domain = data as DomainRow | null

  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 })

  // A connected-only domain (never bought through Quante) is detached from
  // hosting and hard-deleted: a leftover 'expired' row would keep the name
  // blocked for everyone — including whoever really owns it.
  if (!isQuanteRegistered(domain)) {
    try {
      await releaseDomainRow(domain)
    } catch (err) {
      console.error('[domains/[id]] release failed:', err)
      return Response.json({ error: 'Could not remove the domain from hosting. Please try again.' }, { status: 502 })
    }
    return Response.json({ ok: true })
  }

  // Bought through Quante: the registration (and its DNS) still exists on our
  // registrar account, so keep the row as proof of ownership — soft delete.
  await supabaseAdmin
    .from('user_domains')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  return Response.json({ ok: true })
}
