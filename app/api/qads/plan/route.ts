// /api/qads/plan — Qads Plan (lib/qads/plan): a growth plan for one of the caller's stores.
//   GET   the caller's recent plans (newest first), optionally for one store (?projectId=)
//   POST  writes a new plan: brand kit + store products + competitor ads (Meta Ad Library) → one
//         model call → personas, insights, ad concepts and a posting calendar.
// Costs CREDIT_COSTS.qads_plan (included on Agency), charged before the model call and refunded
// when the plan fails. The plan renders nothing: each ad concept opens the normal Ad or
// Character composer, which charges as usual when the owner generates it.

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { debitCredits, refundDebit } from '@/lib/credits'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS } from '@/lib/config'
import { kitPromptBlock } from '@/lib/brand-kit/model'
import { getBrandKit } from '@/lib/brand-kit/store'
import { loadStoreProducts } from '@/lib/qads/store-catalog'
import { PlanInputSchema, buildPlanMessage, isUsablePlan, type PlanInput } from '@/lib/qads/plan/model'
import { RESEARCH_NOTE, researchCompetitors } from '@/lib/qads/plan/ad-library'
import { runPlan } from '@/lib/qads/plan/run'

export const maxDuration = 300

const TABLE = 'qads_plans'
const COST = CREDIT_COSTS.qads_plan
const PER_USER_HOUR = 6
const RUNNING_TTL_MS = 5 * 60_000

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === '42P01' || err.code === 'PGRST205' || /qads_plans/.test(err.message ?? ''))
}

const NOT_SET_UP = { error: 'Qads Plan is not set up yet. The database migration is missing.', setup: true }

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const projectId = new URL(request.url).searchParams.get('projectId')

  let q = supabaseAdmin
    .from(TABLE)
    .select('id, project_id, status, input, research, plan, error, credits_charged, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (projectId) {
    if (!isUuid(projectId)) return NextResponse.json({ error: 'Invalid store.' }, { status: 400 })
    q = q.eq('project_id', projectId)
  }
  const { data, error } = await q
  const researchReady = !!process.env.META_AD_LIBRARY_TOKEN
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ plans: [], ready: false, researchReady })
    return NextResponse.json({ error: 'Could not load your plans.' }, { status: 500 })
  }
  const plans = (data ?? []).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    status: r.status,
    input: r.input,
    research: r.research,
    plan: r.plan,
    error: r.error,
    creditsCharged: r.credits_charged,
    createdAt: r.created_at,
  }))
  return NextResponse.json({ plans, ready: true, researchReady })
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let input: PlanInput
  try {
    input = PlanInputSchema.parse(await request.json())
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid request body'
    return NextResponse.json({ error: detail }, { status: 400 })
  }
  const project = await getOwnedProject<{ id: string; name: string | null }>(input.projectId, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Store not found.' }, { status: 404 })
  if (!rateLimit(`qads-plan:${userId}`, 2, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many plans at once. Wait a minute.' }, { status: 429 })
  }

  // Free checks first: the table exists, nothing is running for this store, hourly cap.
  const since = new Date(Date.now() - RUNNING_TTL_MS).toISOString()
  const running = await supabaseAdmin.from(TABLE).select('id').eq('project_id', project.id).eq('status', 'running').gte('created_at', since).limit(1)
  if (running.error) {
    if (isMissingTable(running.error)) return NextResponse.json(NOT_SET_UP, { status: 503 })
    return NextResponse.json({ error: 'Could not start the plan.' }, { status: 500 })
  }
  if (running.data?.length) return NextResponse.json({ error: 'A plan for this store is already being written.' }, { status: 409 })
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count } = await supabaseAdmin.from(TABLE).select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', hourAgo)
  if ((count ?? 0) >= PER_USER_HOUR) {
    return NextResponse.json({ error: `You can write ${PER_USER_HOUR} plans per hour. Try again later.` }, { status: 429 })
  }

  const products = await loadStoreProducts(project.id)
  const brand = await getBrandKit(project.id, userId)
  const brandNotes = kitPromptBlock(brand.kit)
  if (!products.length && !brandNotes) {
    return NextResponse.json({ error: 'This store has no products or brand kit yet. Add products or fill in the brand kit first.' }, { status: 409 })
  }

  const planId = randomUUID()
  const created = await supabaseAdmin.from(TABLE).insert({ id: planId, user_id: userId, project_id: project.id, status: 'running', input })
  if (created.error) {
    if (isMissingTable(created.error)) return NextResponse.json(NOT_SET_UP, { status: 503 })
    console.error('[qads/plan] insert failed:', created.error.code, created.error.message)
    return NextResponse.json({ error: 'Could not start the plan.' }, { status: 500 })
  }
  const fail = async (error: string, status: number, refund: boolean) => {
    if (refund) await refundDebit(userId, planId, 'qads_plan', 'qads_plan_failed')
    await supabaseAdmin.from(TABLE).update({ status: 'failed', error: error.slice(0, 500), credits_charged: 0, updated_at: new Date().toISOString() }).eq('id', planId)
    return NextResponse.json({ error: refund ? `${error} Your credits were returned.` : error }, { status })
  }

  const agency = await isAgencyUser(userId)
  if (!agency) {
    const debit = await debitCredits(userId, COST, 'qads_plan', planId)
    if (!debit.ok) {
      const msg = debit.error === 'insufficient_credits'
        ? `A plan costs ${COST} credits. Top up in Billing.`
        : debit.error === 'billing_hold' ? 'Your account is on a billing hold. Contact support.' : 'Could not charge the credits.'
      return fail(msg, debit.error === 'insufficient_credits' ? 402 : debit.error === 'billing_hold' ? 403 : 500, false)
    }
  }

  const research = await researchCompetitors(input.competitors, input.country)
  const message = buildPlanMessage({
    storeName: project.name ?? '',
    products: products.map((p) => ({ name: p.name, description: p.description })),
    brandNotes,
    input,
    competitorAds: research.ads,
    researchNote: RESEARCH_NOTE[research.status],
  })
  const run = await runPlan(message, {
    input,
    productNames: products.map((p) => p.name),
    competitorAdIds: research.ads.map((a) => a.id),
  })
  if (!run.ok) return fail(run.error, 502, !agency)
  if (!isUsablePlan(run.plan)) return fail('The plan came back empty. Try again.', 502, !agency)

  const charged = agency ? 0 : COST
  const saved = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'done', research, plan: run.plan, credits_charged: charged, updated_at: new Date().toISOString() })
    .eq('id', planId)
  if (saved.error) {
    console.error('[qads/plan] save failed:', saved.error.code, saved.error.message)
    return fail('The plan could not be saved.', 500, !agency)
  }
  return NextResponse.json({
    plan: {
      id: planId,
      projectId: project.id,
      status: 'done',
      input,
      research,
      plan: run.plan,
      error: null,
      creditsCharged: charged,
      createdAt: new Date().toISOString(),
    },
    charged,
  })
}
