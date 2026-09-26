import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOwnedProject } from '@/lib/auth/project'
import { productionRowsNewestFirst, type RolloutDeploymentRow } from '@/lib/hosting/scaffold-rollout-rules'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const project = await getOwnedProject<{ id: string; custom_domain: string | null; custom_domain_verified: boolean | null }>(
    projectId, userId, 'id, custom_domain, custom_domain_verified',
  )
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('deployments')
    .select('id, vercel_deployment_id, status, url, domain, custom_domain, custom_domain_verified, version, created_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)

  const latest = rows?.[0] ?? null

  // The build shoppers see (draft/publish 2026-09-26): chat edits of a live store are
  // staged drafts, so the newest row is often NOT the live one. Same rules as checkout
  // pricing / the scaffold rollout; before migration-draft-publish.sql there is no
  // promoted_at (the query is retried without it).
  const liveQuery = (columns: string) => supabase
    .from('deployments')
    .select(columns)
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'ready')
    .or('target.is.null,target.eq.production')
    .order('created_at', { ascending: false })
    .limit(20)
  const liveBase = 'id, vercel_deployment_id, status, url, domain, target, code_version_id, version, created_at'
  let liveRes = await liveQuery(`${liveBase}, promoted_at`)
  if (liveRes.error) liveRes = await liveQuery(liveBase)
  const liveRow = productionRowsNewestFirst((liveRes.data ?? []) as unknown as RolloutDeploymentRow[])[0] as
    (RolloutDeploymentRow & { version?: number | null }) | undefined

  const safeUrl = (u: string | null | undefined) => (u && !u.includes('://null')) ? u : null

  return NextResponse.json({
    latest: latest
      ? {
          id: latest.id,
          vercelDeploymentId: latest.vercel_deployment_id,
          status: latest.status,
          url: safeUrl(latest.url),
          domain: latest.domain,
          customDomain: latest.custom_domain ?? project.custom_domain,
          customDomainVerified: latest.custom_domain_verified ?? project.custom_domain_verified ?? false,
          version: latest.version,
          createdAt: latest.created_at,
        }
      : null,
    live: liveRow
      ? {
          id: liveRow.id,
          vercelDeploymentId: liveRow.vercel_deployment_id ?? null,
          status: 'ready',
          url: safeUrl(liveRow.url),
          domain: liveRow.domain,
          customDomain: project.custom_domain,
          customDomainVerified: project.custom_domain_verified ?? false,
          version: liveRow.version ?? null,
        }
      : null,
    history: (rows ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      url: r.url,
      domain: r.domain,
      version: r.version,
      createdAt: r.created_at,
    })),
  })
}
