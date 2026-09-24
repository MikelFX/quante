// GET /api/cron/scaffold-rollout — daily Vercel cron (vercel.json; Hobby allows daily only).
// 1. reconcileRolloutDeployments(): settles recent production builds at the current
//    SCAFFOLD_VERSION that nobody polled (READY → project marked up to date; ERROR →
//    build log excerpt stored in projects.scaffold_update_error).
// 2. Updates up to MAX_STORES_PER_RUN outdated live stores (their LIVE code version,
//    rebuilt with the current scaffold — see lib/hosting/scaffold-rollout.ts), one at a
//    time, within a time budget. Stores that failed MAX_SCAFFOLD_UPDATE_ATTEMPTS times
//    are skipped (Admin → Store updates can retry them explicitly).
// Fails closed without CRON_SECRET (lib/cron-auth.ts). Does nothing (reports
// migrationPending) until supabase/migration-scaffold-version.sql has run.

import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import {
  SCAFFOLD_VERSION,
  findOutdatedStores,
  reconcileRolloutDeployments,
  updateStores,
} from '@/lib/hosting/scaffold-rollout'

export const maxDuration = 300

const MAX_STORES_PER_RUN = 15
// Stop starting new work after this (ms since start); maxDuration is 300s. A store
// started just before the deadline still runs to completion (Vercel project/env setup +
// the inline file upload, typically 10–30 s) — ~90 s of headroom for a slow Vercel API.
const TIME_BUDGET_MS = 210_000
// The reconcile pass may use at most this much of the budget.
const RECONCILE_BUDGET_MS = 60_000

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const deadlineMs = startedAt + TIME_BUDGET_MS

  try {
    const reconciled = await reconcileRolloutDeployments({ deadlineMs: startedAt + RECONCILE_BUDGET_MS })
    if (reconciled.migrationPending) {
      console.warn('[cron/scaffold-rollout] migration-scaffold-version.sql not run yet — nothing to do')
      return NextResponse.json({ ok: true, migrationPending: true, scaffoldVersion: SCAFFOLD_VERSION })
    }

    const found = await findOutdatedStores({ limit: MAX_STORES_PER_RUN, deadlineMs })
    const results = await updateStores(found.stores.map((s) => s.projectId), {
      trigger: 'cron',
      concurrency: 1,
      deadlineMs,
    })

    const summary = {
      ok: true,
      scaffoldVersion: SCAFFOLD_VERSION,
      reconciled,
      found: found.stores.length,
      skippedStores: found.skipped.map((s) => ({ projectId: s.projectId, reason: s.skipReason, attempts: s.attempts })),
      started: results.filter((r) => r.status === 'started').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      partial: found.nextCursor !== null || results.length < found.stores.length,
      results: results.map((r) => ({ projectId: r.projectId, status: r.status, reason: r.reason, error: r.error })),
      ms: Date.now() - startedAt,
    }
    console.log('[cron/scaffold-rollout]', JSON.stringify({ ...summary, results: undefined }))
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[cron/scaffold-rollout] aborted:', err)
    return NextResponse.json({ ok: false, error: 'rollout_failed' }, { status: 500 })
  }
}
