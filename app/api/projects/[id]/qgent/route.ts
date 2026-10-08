// GET /api/projects/[id]/qgent — the Studio's Qgent panel: the latest store review, its
// findings with the diff of every proposed change, and the log of what happened to earlier
// proposals. A proposal whose text no longer matches the current draft is marked 'stale'
// here, so the merchant never confirms a diff that would land somewhere else.
// { ready:false } until supabase/migration-qgent-shop.sql has run.

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { ACTION_COLUMNS, isMissingTable, loadLatestVersion, storeLanguageCode, workingFiles, type ActionRow } from '@/lib/qgent/shop'
import { applyEdits, editHunks } from '@ad/qgent/shop'

interface Params { params: Promise<{ id: string }> }

/** A review still 'running' after this long crashed; the panel may start a new one. */
const RUNNING_TTL_MS = 6 * 60_000

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const reviews = await supabaseAdmin
    .from('qgent_reviews')
    .select('id, created_at, status, summary, ads_brief, error')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (reviews.error) {
    if (isMissingTable(reviews.error)) return NextResponse.json({ ready: false })
    console.error('[qgent] reviews lookup failed:', reviews.error.message)
    return NextResponse.json({ error: 'Could not load Qgent.' }, { status: 500 })
  }
  const actionsRes = await supabaseAdmin
    .from('qgent_actions')
    .select(ACTION_COLUMNS)
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(60)
  if (actionsRes.error) {
    console.error('[qgent] actions lookup failed:', actionsRes.error.message)
    return NextResponse.json({ error: 'Could not load Qgent.' }, { status: 500 })
  }
  const rows = (actionsRes.data ?? []) as unknown as ActionRow[]

  const latest = await loadLatestVersion(id)
  const files = latest ? workingFiles(latest.files) : {}

  // Proposals that no longer apply to the current draft go stale (shown in the log, not as a diff).
  const stale: string[] = []
  for (const r of rows) {
    if (r.status === 'proposed' && !applyEdits(files, r.edits ?? []).ok) {
      r.status = 'stale'
      r.error = 'The store changed since this was suggested. Run a new review.'
      stale.push(r.id)
    }
  }
  if (stale.length) {
    await supabaseAdmin
      .from('qgent_actions')
      .update({ status: 'stale', error: 'The store changed since this was suggested. Run a new review.', updated_at: new Date().toISOString() })
      .in('id', stale)
      .eq('status', 'proposed')
  }

  const versionIds = [...new Set(rows.flatMap((r) => [r.applied_version_id, r.reverted_version_id]).filter((v): v is string => !!v))]
  const versionNo = new Map<string, number>()
  if (versionIds.length) {
    const { data } = await supabaseAdmin.from('code_versions').select('id, version_no').in('id', versionIds)
    for (const v of data ?? []) versionNo.set(v.id as string, v.version_no as number)
  }

  const review = reviews.data?.[0] ?? null
  const running = !!review && review.status === 'running' && Date.now() - new Date(review.created_at).getTime() < RUNNING_TTL_MS

  return NextResponse.json({
    ready: true,
    hasStore: !!latest,
    agency: await isAgencyUser(userId),
    language: storeLanguageCode(files),
    costs: { review: CREDIT_COSTS.qgent_review, apply: CREDIT_COSTS.qgent_apply },
    review: review
      ? {
          id: review.id,
          createdAt: review.created_at,
          status: running ? 'running' : review.status === 'running' ? 'failed' : review.status,
          summary: review.summary,
          adsBrief: review.ads_brief,
          error: review.error,
        }
      : null,
    actions: rows.map((r) => ({
      id: r.id,
      reviewId: r.review_id,
      title: r.title,
      why: r.why,
      area: r.area,
      severity: r.severity,
      status: r.status,
      sensitiveReasons: r.sensitive_reasons ?? [],
      // Proposed: against the current draft. Applied / undone: what the change did.
      hunks:
        r.status === 'proposed'
          ? editHunks(files, r.edits ?? [])
          : r.files_before && (r.status === 'applied' || r.status === 'reverted')
            ? editHunks(r.files_before, r.edits ?? [])
            : [],
      appliedVersionNo: r.applied_version_id ? versionNo.get(r.applied_version_id) ?? null : null,
      revertedVersionNo: r.reverted_version_id ? versionNo.get(r.reverted_version_id) ?? null : null,
      creditsCharged: r.credits_charged,
      error: r.error,
      createdAt: r.created_at,
      confirmedAt: r.confirmed_at,
      sensitiveConfirmedAt: r.sensitive_confirmed_at,
      revertedAt: r.reverted_at,
    })),
  })
}
