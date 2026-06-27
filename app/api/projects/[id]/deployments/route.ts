import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('deployments')
    .select('id, vercel_deployment_id, status, url, domain, custom_domain, custom_domain_verified, version, created_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)

  const latest = rows?.[0] ?? null

  return NextResponse.json({
    latest: latest
      ? {
          id: latest.id,
          vercelDeploymentId: latest.vercel_deployment_id,
          status: latest.status,
          url: (latest.url && !latest.url.includes('://null')) ? latest.url : null,
          domain: latest.domain,
          customDomain: latest.custom_domain,
          customDomainVerified: latest.custom_domain_verified,
          version: latest.version,
          createdAt: latest.created_at,
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
