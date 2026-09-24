// GET /api/projects/[id]/scaffold-status — owner only.
// Whether the store's LIVE production build runs an older platform scaffold than
// SCAFFOLD_VERSION, and whether the owner may update it now (Studio "store update"
// banner → POST /api/projects/[id]/scaffold-update). DB only — no Vercel API calls and
// no writes (the Studio calls it on every load), so it needs no throttle.
// → { outdated, currentVersion, liveVersion, building, buildingDeploymentId, lastError, canUpdate, reason }

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getOwnedProject } from '@/lib/auth/project'
import { getScaffoldStatus } from '@/lib/hosting/scaffold-rollout'

interface Params { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check (service-role client — RLS does not protect us here).
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const status = await getScaffoldStatus(project.id)
  return NextResponse.json({
    outdated: status.outdated,
    currentVersion: status.currentVersion,
    liveVersion: status.liveVersion,
    building: status.building,
    buildingDeploymentId: status.buildingDeploymentId,
    // Raw Vercel build log excerpt of the last failed update (the owner's own store).
    lastError: status.lastError ? status.lastError.slice(0, 800) : null,
    canUpdate: status.canUpdate,
    reason: status.reason ?? null,
  })
}
