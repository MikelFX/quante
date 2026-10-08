// POST /api/projects/[id]/qgent/review — Qgent goes through the whole store (latest draft) and
// proposes fixes. Costs CREDIT_COSTS.qgent_review (free on Agency), refunded when the review
// fails. Nothing in the store changes here: every finding is stored as a proposal (with
// edits that apply cleanly and pass the store-file safety filter) or as advice, and the
// merchant decides in the panel (app/api/projects/[id]/qgent/actions/[actionId]).

import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { debitCredits, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { checkFinding, isMissingTable, loadLatestVersion, runReview, workingFiles } from '@/lib/qgent/shop'

export const maxDuration = 300

interface Params { params: Promise<{ id: string }> }

const PER_USER_HOUR = 6
const RUNNING_TTL_MS = 6 * 60_000
const COST = CREDIT_COSTS.qgent_review

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string; name: string | null }>(id, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!rateLimit(`qgent-review:${userId}`, 3, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many reviews at once. Wait a minute.' }, { status: 429 })
  }

  const latest = await loadLatestVersion(id)
  if (!latest) return NextResponse.json({ error: 'Generate your store first.' }, { status: 409 })

  const since = new Date(Date.now() - RUNNING_TTL_MS).toISOString()
  const running = await supabaseAdmin.from('qgent_reviews').select('id').eq('project_id', id).eq('status', 'running').gte('created_at', since).limit(1)
  if (running.error) {
    if (isMissingTable(running.error)) return NextResponse.json({ error: 'Qgent is not set up yet. The database migration is missing.', setup: true }, { status: 503 })
    return NextResponse.json({ error: 'Could not start the review.' }, { status: 500 })
  }
  if (running.data?.length) return NextResponse.json({ error: 'A review of this store is already running.' }, { status: 409 })

  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabaseAdmin.from('qgent_reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', hourAgo)
  if ((count ?? 0) >= PER_USER_HOUR) {
    return NextResponse.json({ error: `You can run ${PER_USER_HOUR} reviews per hour. Try again later.` }, { status: 429 })
  }

  const reviewId = randomUUID()
  const created = await supabaseAdmin
    .from('qgent_reviews')
    .insert({ id: reviewId, project_id: id, user_id: userId, base_version_id: latest.id, status: 'running' })
  if (created.error) {
    console.error('[qgent] review insert failed:', created.error.code, created.error.message)
    return NextResponse.json({ error: 'Could not start the review.' }, { status: 500 })
  }
  const fail = async (error: string, status: number, refund: boolean) => {
    if (refund) await refundDebit(userId, reviewId, 'qgent_review', 'qgent_review_failed')
    await supabaseAdmin.from('qgent_reviews').update({ status: 'failed', error: error.slice(0, 500), credits_charged: 0 }).eq('id', reviewId)
    return NextResponse.json({ error: refund ? `${error} Your credits were returned.` : error }, { status })
  }

  const agency = await isAgencyUser(userId)
  if (!agency) {
    const debit = await debitCredits(userId, COST, 'qgent_review', reviewId)
    if (!debit.ok) {
      const msg = debit.error === 'insufficient_credits'
        ? `A review costs ${COST} credits. Top up in Billing.`
        : debit.error === 'billing_hold' ? 'Your account is on a billing hold. Contact support.' : 'Could not charge the credits.'
      return fail(msg, debit.error === 'insufficient_credits' ? 402 : debit.error === 'billing_hold' ? 403 : 500, false)
    }
  }

  const files = workingFiles(latest.files)
  const run = await runReview(files, project.name ?? '')
  if (!run.ok) return fail(run.error, 502, !agency)

  // Earlier proposals are replaced by this review (the log keeps them as 'stale').
  await supabaseAdmin
    .from('qgent_actions')
    .update({ status: 'stale', error: 'Replaced by a newer review.', updated_at: new Date().toISOString() })
    .eq('project_id', id)
    .eq('status', 'proposed')

  const rows = run.review.findings.map((f) => {
    const c = checkFinding(files, f.edits)
    return {
      review_id: reviewId,
      project_id: id,
      user_id: userId,
      title: f.title,
      why: f.why,
      area: f.area,
      severity: f.severity,
      edits: c.edits,
      sensitive_reasons: c.sensitive,
      status: c.status,
      error: c.error,
    }
  })
  if (rows.length) {
    const ins = await supabaseAdmin.from('qgent_actions').insert(rows)
    if (ins.error) {
      console.error('[qgent] actions insert failed:', ins.error.code, ins.error.message)
      return fail('The review could not be saved.', 500, !agency)
    }
  }
  await supabaseAdmin
    .from('qgent_reviews')
    .update({ status: 'done', summary: run.review.summary, ads_brief: run.review.adsBrief, credits_charged: agency ? 0 : COST })
    .eq('id', reviewId)

  return NextResponse.json({ ok: true, reviewId, findings: rows.length, charged: agency ? 0 : COST })
}
