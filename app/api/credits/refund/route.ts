import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { getDeploymentStatus } from '@/lib/hosting/vercel'

// Refunds the generate/iterate debit for a code version whose deployment could
// not be repaired by the auto-fix loop. Idempotent — the refund_credits RPC
// refunds at most once per version.

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = rateLimit(`refund:${userId}`, 10, 3_600_000)
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many refund requests.' }, { status: 429 })
  }

  const { versionId } = await request.json()
  if (!versionId) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  }

  // Ownership check
  const { data: version } = await supabaseAdmin
    .from('code_versions')
    .select('id, project_id, user_id')
    .eq('id', versionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  // Server-side validation: the project's latest deployment must actually be failed.
  // (Fix attempts create newer versions, so we check the latest deployment overall.)
  const { data: latestDeploy } = await supabaseAdmin
    .from('deployments')
    .select('id, status, vercel_deployment_id')
    .eq('project_id', version.project_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestDeploy) {
    return NextResponse.json({ error: 'No deployment found.' }, { status: 409 })
  }

  let failed = latestDeploy.status === 'error' || latestDeploy.status === 'canceled'

  // DB may lag behind Vercel (SSE writes status async) — verify live before rejecting.
  if (!failed && latestDeploy.vercel_deployment_id) {
    try {
      const live = await getDeploymentStatus(latestDeploy.vercel_deployment_id)
      if (live.state === 'error' || live.state === 'canceled') {
        failed = true
        await supabaseAdmin
          .from('deployments')
          .update({ status: live.state, updated_at: new Date().toISOString() })
          .eq('id', latestDeploy.id)
      }
    } catch (err) {
      console.error('[refund] live status check failed:', err)
    }
  }

  if (!failed) {
    return NextResponse.json({ error: 'Latest deployment is not in a failed state.' }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin.rpc('refund_credits', {
    p_user_id: userId,
    p_ref_id: versionId,
  })

  if (error) {
    console.error('[refund] rpc failed:', error)
    return NextResponse.json({ error: 'Refund failed.' }, { status: 500 })
  }

  return NextResponse.json(data)
}
