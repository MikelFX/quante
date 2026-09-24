// Admin → Store updates (automatic store scaffold rollout, lib/hosting/scaffold-rollout.ts).
//
// GET  /api/admin/scaffold-rollout   status summary of every live store (DB only, approximate)
//      → { scaffoldVersion, migrationPending?, counts: { upToDate, outdated, building, failed, skipped }, partial }
// POST /api/admin/scaffold-rollout   body { dryRun?: boolean = true, limit?: 1..25 = 10, projectIds?: string[] }
//      dryRun → { dryRun: true, stores: [...outdated, would update], skipped: [...] }
//      else   → updates up to `limit` stores (concurrency 3)
//               → { dryRun: false, results: [...], notStarted: [ids cut off by the time budget] }
//      With projectIds the given stores are updated directly (attempt cap ignored — an
//      explicit admin retry); without, the outdated stores are found by scanning.
//
// Admin only (lib/admin.ts requireAdmin: verified primary email in ADMIN_EMAILS; fails
// closed). Free for store owners — no credits are touched.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'
import { isUuid } from '@/lib/auth/project'
import {
  SCAFFOLD_VERSION,
  findOutdatedStores,
  updateStores,
} from '@/lib/hosting/scaffold-rollout'

export const maxDuration = 300

const MAX_LIMIT = 25
const DEFAULT_LIMIT = 10
const MAX_PROJECT_IDS = 50
// Leave headroom under maxDuration: a store started just before the deadline still runs
// to completion (Vercel project/env setup + file upload).
const TIME_BUDGET_MS = 210_000
const SUMMARY_BUDGET_MS = 60_000

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // DB only (light): no Vercel calls, no hosting-gate lookups and no writes on a GET —
  // the admin page loads this on every visit. Counts are approximate (stale unpolled
  // builds are not settled, hosting-inactive stores are not separated out); the dry run
  // does the full check.
  const deadlineMs = Date.now() + SUMMARY_BUDGET_MS
  try {
    const found = await findOutdatedStores({ limit: 1000, scanAll: true, deadlineMs, light: true })
    return NextResponse.json({
      scaffoldVersion: SCAFFOLD_VERSION,
      migrationPending: found.migrationPending ?? false,
      counts: found.counts,
      partial: found.nextCursor !== null,
    })
  } catch (err) {
    console.error('[admin/scaffold-rollout] summary failed:', err)
    return NextResponse.json({ error: 'Could not load the store update summary.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { dryRun?: unknown; limit?: unknown; projectIds?: unknown }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const dryRun = body.dryRun !== false // default true — deploying needs an explicit false
  const rawLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.floor(body.limit) : DEFAULT_LIMIT
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit))

  let projectIds: string[] | undefined
  if (body.projectIds !== undefined) {
    if (!Array.isArray(body.projectIds) || body.projectIds.length > MAX_PROJECT_IDS) {
      return NextResponse.json({ error: `projectIds must be an array of at most ${MAX_PROJECT_IDS} ids` }, { status: 400 })
    }
    projectIds = [...new Set(body.projectIds.filter(isUuid))]
    if (projectIds.length !== body.projectIds.length) {
      return NextResponse.json({ error: 'projectIds must contain valid project ids' }, { status: 400 })
    }
  }

  const deadlineMs = Date.now() + TIME_BUDGET_MS

  try {
    if (dryRun) {
      const found = await findOutdatedStores({
        limit: projectIds ? projectIds.length || 1 : limit,
        projectIds,
        deadlineMs,
        ignoreAttemptCap: !!projectIds,
      })
      return NextResponse.json({
        dryRun: true,
        scaffoldVersion: SCAFFOLD_VERSION,
        migrationPending: found.migrationPending ?? false,
        stores: found.stores,
        skipped: found.skipped,
        more: found.nextCursor !== null,
      })
    }

    let ids: string[]
    if (projectIds) {
      ids = projectIds.slice(0, limit)
    } else {
      const found = await findOutdatedStores({ limit, deadlineMs })
      if (found.migrationPending) {
        return NextResponse.json({
          dryRun: false, scaffoldVersion: SCAFFOLD_VERSION, migrationPending: true, results: [],
        })
      }
      ids = found.stores.map((s) => s.projectId)
    }

    const results = await updateStores(ids, {
      trigger: 'admin',
      concurrency: 3,
      deadlineMs,
      ignoreAttemptCap: !!projectIds,
    })
    const notStarted = ids.filter((id) => !results.some((r) => r.projectId === id))
    console.log('[admin/scaffold-rollout] run by admin', {
      admin, requested: ids.length, started: results.filter((r) => r.status === 'started').length,
    })
    return NextResponse.json({ dryRun: false, scaffoldVersion: SCAFFOLD_VERSION, results, notStarted })
  } catch (err) {
    console.error('[admin/scaffold-rollout] run failed:', err)
    return NextResponse.json({ error: 'Store update run failed.' }, { status: 500 })
  }
}
