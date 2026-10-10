import { randomUUID } from 'crypto'
import { after, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { activeProjectLimit, getUserRecord, isAgencyUser } from '@/lib/tier'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits } from '@/lib/credits'
import { AGENCY_FAIR_USE, CREDIT_COSTS } from '@/lib/config'
import { IN_FLIGHT_WINDOW_MS, MAX_BRIEF_CHARS, refundGeneration, runGeneration } from '@/lib/generation/run'

// 300s = Hobby/Pro hard cap. Raise to 800 (Enterprise, current platform max) once
// plan is upgraded, then also raise SOFT_TIMEOUT_MS for slower thinking-mode primaries.
// `after()`'s callback runs within this SAME budget — it does not grant extra time beyond it.
export const maxDuration = 300


const GENERATE_COST = CREDIT_COSTS.generate
// Counts generation_jobs rows of EVERY status (failed ones included) — failed runs still
// burn a full model call on our side, so they must count toward the hourly limit.
const GENERATE_RATE_LIMIT = 5
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

// The generation itself (Claude → files → project + code version → preview deploy) lives in
// lib/generation/run.ts, shared with the Agency batch runner (lib/generation/batch.ts).

/** Number of this user's 'running' jobs started inside the in-flight window. */
async function countInFlightJobs(userId: string): Promise<number | null> {
  const since = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { count, error } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'running').gte('created_at', since)
  if (error) {
    console.error('[generate] in-flight count failed:', error.message)
    return null
  }
  return count ?? 0
}

/**
 * After our own job row exists: is it the oldest of this user's in-flight jobs? Racing
 * requests all see the same set of rows, so exactly one (the oldest) proceeds instead of
 * all of them backing out. null = lookup failed.
 */
async function isOldestInFlightJob(userId: string, jobId: string): Promise<boolean | null> {
  const since = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('generation_jobs').select('id')
    .eq('user_id', userId).eq('status', 'running').gte('created_at', since)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[generate] in-flight re-check failed:', error.message)
    return null
  }
  return (data ?? [])[0]?.id === jobId
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const { brief: rawBrief, projectName: rawProjectName, projectId: rawProjectId } = body ?? {}

  const brief = typeof rawBrief === 'string' ? rawBrief.trim() : ''
  if (!brief) {
    return NextResponse.json({ error: 'Brief is required.' }, { status: 400 })
  }
  if (brief.length > MAX_BRIEF_CHARS) {
    return NextResponse.json({ error: `Brief is too long (max ${MAX_BRIEF_CHARS} characters).` }, { status: 400 })
  }
  const projectName = typeof rawProjectName === 'string' ? rawProjectName.trim().slice(0, 100) || undefined : undefined

  // The client-supplied projectId decides which project the generated code is written
  // into (and later deployed from) — it must belong to the caller.
  let existingProjectId: string | undefined
  if (rawProjectId !== undefined && rawProjectId !== null && rawProjectId !== '') {
    const owned = await getOwnedProject<{ id: string }>(rawProjectId, userId, 'id')
    if (!owned) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    existingProjectId = owned.id
  }

  // Jobs still 'running' past the in-flight window were killed by the platform before
  // their own failure handling ran — close them out and refund their debit (capped, since
  // a deliberately slow brief can cause this). Only jobs that never saved code qualify.
  const staleBefore = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { data: staleJobs } = await supabaseAdmin
    .from('generation_jobs')
    .update({ status: 'failed', phase: null, error: 'Generation timed out.', raw_output: '', files: {} })
    .eq('user_id', userId).eq('status', 'running').lt('created_at', staleBefore).is('code_version_id', null)
    .select('id, credits_debited')
  for (const stale of staleJobs ?? []) {
    if (stale.credits_debited !== false) await refundGeneration(userId, stale.id as string, true)
  }

  // Agency: no credits and no project limit, behind the daily fair-use cap instead.
  const agency = await isAgencyUser(userId)

  // One generation in flight per user — parallel requests used to all pass the checks
  // below before any of them had written anything.
  const inFlight = await countInFlightJobs(userId)
  if (inFlight === null) {
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }
  if (inFlight > 0) {
    return NextResponse.json({ error: 'A generation is already running. Please wait for it to finish.' }, { status: 409 })
  }

  // Rate limit — counts job rows of every status, so failed generations count too.
  const hourly = agency ? AGENCY_FAIR_USE.generationsPerHour : GENERATE_RATE_LIMIT
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count: recentCount, error: recentError } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', oneHourAgo)

  if (recentError || (recentCount ?? 0) >= hourly) {
    return NextResponse.json(
      { error: `Rate limit reached — max ${hourly} generations per hour.` },
      { status: 429 },
    )
  }
  if (agency) {
    const { count: dayCount, error: dayError } = await supabaseAdmin
      .from('generation_jobs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
    if (dayError || (dayCount ?? 0) >= AGENCY_FAIR_USE.generationsPerDay) {
      return NextResponse.json(
        { error: `Fair-use limit reached — the Agency plan includes ${AGENCY_FAIR_USE.generationsPerDay} generations a day. Try again later.` },
        { status: 429 },
      )
    }
  }

  // Project limit check — fail fast before calling Claude (only when creating a new project).
  // Racing requests can't both pass it: the in-flight re-check below lets only one through.
  const limit = activeProjectLimit(await getUserRecord(userId), agency)
  if (!existingProjectId && limit !== null) {
    const { count: activeCount } = await supabaseAdmin
      .from('projects').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).neq('status', 'archived')
    if ((activeCount ?? 0) >= limit) {
      return NextResponse.json({
        error: `Active project limit reached (${activeCount ?? 0}/${limit}). Delete a project first, or upgrade to Agency for unlimited stores.`,
      }, { status: 403 })
    }
  }

  // Debit up front, atomically, keyed by the job id — the balance check and the debit are
  // one locked DB operation, so parallel requests can't overspend, and no later write
  // can overwrite credit movements that happen while the job runs. Refunded on failure.
  // Agency debits nothing (fair use above).
  const jobId = randomUUID()
  const charged = !agency
  const debit = charged ? await debitCredits(userId, GENERATE_COST, 'generate', jobId) : ({ ok: true } as const)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return NextResponse.json({ error: `Insufficient credits. Need ${GENERATE_COST}, have ${debit.balance ?? 0}.` }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }

  // The generation_jobs row is what the client polls — unlike Level 1 (where a failed
  // insert here just meant "no checkpointing this run, generation proceeds anyway"), this
  // is now load-bearing: with no job row, there is nothing for the client to poll, so a
  // failed insert here must fail the whole request rather than silently degrading.
  const { data: job, error: jobError } = await supabaseAdmin
    .from('generation_jobs')
    .insert({
      id: jobId,
      user_id: userId,
      project_id: existingProjectId ?? null,
      brief,
      status: 'running',
      phase: 'designing',
      credits_debited: charged,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    console.error('[generate] generation_jobs insert failed:', jobError)
    if (charged) await refundGeneration(userId, jobId, false)
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }

  // Re-check after our own row exists: if requests raced past the first check, only the
  // oldest in-flight job runs; the others back out (refunded). A backed-out row did no
  // model work, so it is deleted — it must not count toward the hourly limit.
  const oldest = await isOldestInFlightJob(userId, jobId)
  if (oldest !== true) {
    const { error: deleteError } = await supabaseAdmin.from('generation_jobs').delete().eq('id', jobId)
    if (deleteError) {
      await supabaseAdmin
        .from('generation_jobs')
        .update({ status: 'failed', phase: null, error: 'A generation is already running.' })
        .eq('id', jobId)
    }
    if (charged) await refundGeneration(userId, jobId, false)
    return oldest === null
      ? NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
      : NextResponse.json({ error: 'A generation is already running. Please wait for it to finish.' }, { status: 409 })
  }

  // Scheduled to run after this response is sent — explicitly decoupled from the client's
  // HTTP connection (see the long comment on runGeneration above). Uses supabaseAdmin
  // (service role) throughout, since everything past this point runs outside the normal
  // request lifecycle.
  after(() => runGeneration({
    jobId,
    userId,
    brief,
    projectName,
    existingProjectId,
    agency,
    charged,
  }))

  return NextResponse.json({ jobId, projectId: existingProjectId ?? null }, { status: 202 })
}
