// POST /api/projects/[id]/scaffold-update — owner only, free.
// Rebuilds the store's LIVE code version with the current platform scaffold and deploys
// it to production (lib/hosting/scaffold-rollout.ts updateStoreScaffold). Unpublished
// edits are never published: the version that is live stays the version that is live.
// If the build fails, Vercel keeps serving the previous production deployment.
// → 200 { ok: true, deploymentId, url, droppedFiles? } | 4xx/5xx { error, reason }
//
// Throttles (DB-backed, fail closed): max 3 production builds of this project per hour,
// plus the per-user deploy caps shared with /api/deploy and /api/projects/[id]/redeploy.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { isUnknownColumnError } from '@/lib/hosting/deployments'
import { updateStoreScaffold, type RolloutSkipReason } from '@/lib/hosting/scaffold-rollout'

export const maxDuration = 120

const HOUR_MS = 60 * 60 * 1000
const MAX_PROJECT_UPDATES_PER_HOUR = 3
// Same per-user caps as /api/projects/[id]/redeploy (every deployments row counts).
const WINDOW_MS = 10 * 60 * 1000
const MAX_DEPLOYS_PER_WINDOW = 20
const MAX_DEPLOYS_PER_HOUR = 40

interface Params { params: Promise<{ id: string }> }

const SKIP_RESPONSES: Record<RolloutSkipReason, { status: number; error: string }> = {
  migration_pending: { status: 503, error: 'Store updates are not available yet. Please try again later.' },
  lookup_failed: { status: 503, error: 'Could not check your store right now. Please try again.' },
  project_not_found: { status: 404, error: 'Project not found' },
  not_live: { status: 409, error: 'This store is not live yet — nothing to update.' },
  suspended: { status: 402, error: 'Hosting for this store is paused. Subscribe to bring it back online.' },
  hosting_inactive: { status: 402, error: 'Your hosting plan does not allow deploying this store right now. Subscribe to continue hosting.' },
  attempts_exhausted: { status: 409, error: 'The store update failed several times. Please contact support.' },
  no_live_version: { status: 409, error: 'No live version of this store was found to update.' },
  up_to_date: { status: 409, error: 'Your store is already up to date.' },
  already_building: { status: 409, error: 'A store update is already running.' },
  in_progress: { status: 409, error: 'A store update was just started. Please wait a moment.' },
  platform_url_missing: { status: 503, error: 'Deployments are temporarily unavailable.' },
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check (service-role client — RLS does not protect us here).
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const since = (ms: number) => new Date(Date.now() - ms).toISOString()
  const [projectHour, userWindow, userHour] = await Promise.all([
    supabaseAdmin
      .from('deployments')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .eq('target', 'production')
      .gte('created_at', since(HOUR_MS)),
    supabaseAdmin
      .from('deployments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since(WINDOW_MS)),
    supabaseAdmin
      .from('deployments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since(HOUR_MS)),
  ])
  if (projectHour.error && isUnknownColumnError(projectHour.error)) {
    return NextResponse.json({ error: SKIP_RESPONSES.migration_pending.error, reason: 'migration_pending' }, { status: 503 })
  }
  if (projectHour.error || userWindow.error || userHour.error) {
    console.error('[scaffold-update] throttle lookup failed:', projectHour.error ?? userWindow.error ?? userHour.error)
    return NextResponse.json({ error: 'Could not start the update right now. Please try again.' }, { status: 503 })
  }
  if ((projectHour.count ?? 0) >= MAX_PROJECT_UPDATES_PER_HOUR) {
    return NextResponse.json({ error: 'Too many deployments of this store. Please try again later.' }, { status: 429 })
  }
  if ((userWindow.count ?? 0) >= MAX_DEPLOYS_PER_WINDOW || (userHour.count ?? 0) >= MAX_DEPLOYS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many deployments. Please wait a few minutes.' }, { status: 429 })
  }

  // The owner may retry past the cron's attempt cap (bounded by the throttles above).
  const result = await updateStoreScaffold(project.id, { trigger: 'owner', ignoreAttemptCap: true })

  if (result.status === 'started') {
    return NextResponse.json({
      ok: true,
      deploymentId: result.deploymentId,
      url: result.url,
      droppedFiles: result.droppedFiles ?? [],
    })
  }
  if (result.status === 'skipped' && result.reason && result.reason !== 'error') {
    const r = SKIP_RESPONSES[result.reason]
    return NextResponse.json(
      {
        error: r.error,
        reason: result.reason,
        ...(result.reason === 'already_building' && result.deploymentId ? { deploymentId: result.deploymentId } : {}),
      },
      { status: r.status },
    )
  }
  return NextResponse.json(
    { error: 'The store update could not be started. Your live store was not changed.', reason: 'error' },
    { status: 500 },
  )
}
