// Agency batch generation: up to AGENCY_BATCH_SIZE stores from one request. Server-only.
//
// A batch is the set of generation_jobs rows sharing batch_id (supabase/migration-generation-
// batches.sql). Rows start 'queued'; kickBatch() moves up to AGENCY_BATCH_CONCURRENCY of them to
// 'running' and runs each through exactly the pipeline of a single generation
// (lib/generation/run.ts) inside after(), so every store gets its own 300 s budget.
//
// Who kicks: the batch POST, every status poll (the batch page, the dashboard banner), in
// production each finished job (POST /api/quante/batch/[id]/kick, CRON_SECRET — the next store
// starts right away with no page open) and, as a safety net, the per-minute cron
// /api/cron/batch-kick. A claim is an atomic `update … where status = 'queued'`, so overlapping
// kicks never start a job twice.
//
// Agency only: no credits are debited (credits_debited false) and the project limit doesn't
// apply; the daily fair-use cap counts every job of the batch up front.
import { randomUUID } from 'crypto'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { AGENCY_BATCH_CONCURRENCY, AGENCY_BATCH_SIZE, AGENCY_FAIR_USE } from '@/lib/config'
import { APP_ORIGIN } from '@/lib/domains'
import { IN_FLIGHT_WINDOW_MS, MAX_BRIEF_CHARS, runGeneration } from './run'

const DAY_MS = 86_400_000
const MAX_NAME_CHARS = 100

export interface BatchItem { brief: string; name?: string }

export type BatchJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface BatchJob {
  id: string
  name: string | null
  status: BatchJobStatus
  phase: string | null
  projectId: string | null
  previewUrl: string | null
  error: string | null
  deployError: string | null
}

export interface BatchSummary {
  batchId: string
  createdAt: string
  total: number
  queued: number
  running: number
  completed: number
  failed: number
}

type Fail = { ok: false; status: number; error: string }

/** Missing column / table = the migration has not run yet. */
function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /batch_id|batch_index|project_name/.test(error.message ?? '')
}

const MIGRATION_MISSING: Fail = {
  ok: false,
  status: 503,
  error: 'Batch generation needs a database update first (supabase/migration-generation-batches.sql).',
}

/** Validates the merchant's list: 1–AGENCY_BATCH_SIZE stores, each with a brief. */
export function parseBatchItems(input: unknown): { ok: true; items: Required<BatchItem>[] } | Fail {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, status: 400, error: 'Add at least one store.' }
  if (input.length > AGENCY_BATCH_SIZE) return { ok: false, status: 400, error: `At most ${AGENCY_BATCH_SIZE} stores per batch.` }
  const items: Required<BatchItem>[] = []
  for (const [i, raw] of input.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>
    const brief = typeof r.brief === 'string' ? r.brief.trim() : ''
    if (!brief) return { ok: false, status: 400, error: `Store ${i + 1} has no brief.` }
    if (brief.length > MAX_BRIEF_CHARS) return { ok: false, status: 400, error: `Store ${i + 1}: the brief is too long (max ${MAX_BRIEF_CHARS} characters).` }
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME_CHARS) : ''
    items.push({ brief, name })
  }
  return { ok: true, items }
}

/** Queued jobs that waited a day are dropped — an abandoned batch must not block the next one. */
async function expireOldQueued(userId: string) {
  await supabaseAdmin
    .from('generation_jobs')
    .update({ status: 'failed', phase: null, error: 'Batch expired before this store was started.' })
    .eq('user_id', userId).eq('status', 'queued').not('batch_id', 'is', null)
    .lt('created_at', new Date(Date.now() - DAY_MS).toISOString())
}

/**
 * A batch job still 'running' past the in-flight window was killed with its invocation: close it
 * so it stops holding a slot or blocking the next batch. Code already saved = the store exists
 * (only its preview deploy may be missing) → completed; otherwise failed. Agency: nothing was
 * debited, nothing to refund. `batchId` null = all of the user's batches.
 */
async function closeStale(userId: string, batchId: string | null) {
  const stale = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  for (const saved of [false, true]) {
    let q = supabaseAdmin.from('generation_jobs')
      .update(saved ? { status: 'completed', phase: null } : { status: 'failed', phase: null, error: 'Generation timed out.', raw_output: '', files: {} })
      .eq('user_id', userId).eq('status', 'running').lt('created_at', stale)
    q = batchId ? q.eq('batch_id', batchId) : q.not('batch_id', 'is', null)
    await (saved ? q.not('code_version_id', 'is', null) : q.is('code_version_id', null))
  }
}

/**
 * Creates the batch (all rows 'queued') and starts the first stores. Agency callers only — the
 * route checks that. Insert-then-verify: the fair-use cap and "one batch at a time" are checked
 * again after our rows exist, so two parallel requests can't both pass.
 */
export async function createBatch(userId: string, items: Required<BatchItem>[]): Promise<{ ok: true; batchId: string } | Fail> {
  await expireOldQueued(userId)
  await closeStale(userId, null)

  const since = new Date(Date.now() - DAY_MS).toISOString()
  const { count: today, error: countError } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since)
  if (countError) return { ok: false, status: 500, error: 'Could not start the batch. Please try again.' }
  const left = AGENCY_FAIR_USE.generationsPerDay - (today ?? 0)
  if (items.length > left) {
    return {
      ok: false,
      status: 429,
      error: left > 0
        ? `Fair use: ${left} more store generation${left === 1 ? '' : 's'} today (the Agency plan includes ${AGENCY_FAIR_USE.generationsPerDay} a day). Shorten the list or try tomorrow.`
        : `Fair-use limit reached — the Agency plan includes ${AGENCY_FAIR_USE.generationsPerDay} generations a day. Try again later.`,
    }
  }

  const batchId = randomUUID()
  const rows = items.map((it, i) => ({
    id: randomUUID(),
    batch_index: i,
    user_id: userId,
    brief: it.brief,
    project_name: it.name || null,
    status: 'queued',
    phase: null,
    credits_debited: false,
    batch_id: batchId,
  }))
  const { error: insertError } = await supabaseAdmin.from('generation_jobs').insert(rows)
  if (insertError) {
    if (isMissingSchema(insertError)) return MIGRATION_MISSING
    console.error('[batch] insert failed:', insertError.message)
    return { ok: false, status: 500, error: 'Could not start the batch. Please try again.' }
  }

  const drop = async () => { await supabaseAdmin.from('generation_jobs').delete().eq('batch_id', batchId).eq('user_id', userId) }

  // One active batch per user: any other unfinished batch means ours backs out. Two batches
  // created at the same moment both back out — never both run. (No ordering by time: a claim
  // restarts created_at, and clocks differ between the app and the database.)
  const { data: other, error: otherError } = await supabaseAdmin
    .from('generation_jobs').select('batch_id')
    .eq('user_id', userId).not('batch_id', 'is', null).in('status', ['queued', 'running'])
    .neq('batch_id', batchId)
    .limit(1)
  if (otherError || (other ?? []).length > 0) {
    await drop()
    return otherError
      ? { ok: false, status: 500, error: 'Could not start the batch. Please try again.' }
      : { ok: false, status: 409, error: 'A batch is already running. Wait for it to finish, then start the next one.' }
  }
  const { count: after24h } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since)
  if ((after24h ?? 0) > AGENCY_FAIR_USE.generationsPerDay) {
    await drop()
    return { ok: false, status: 429, error: `Fair-use limit reached — the Agency plan includes ${AGENCY_FAIR_USE.generationsPerDay} generations a day.` }
  }

  await kickBatch(batchId, userId)
  return { ok: true, batchId }
}

/**
 * Starts queued stores of the batch while fewer than AGENCY_BATCH_CONCURRENCY run. Each runs in
 * after() of the current request. Returns how many it started. Safe to call often.
 */
export async function kickBatch(batchId: string, userId: string): Promise<number> {
  await closeStale(userId, batchId)

  const { count: running, error: runningError } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'running')
  if (runningError) return 0
  const slots = AGENCY_BATCH_CONCURRENCY - (running ?? 0)
  if (slots <= 0) return 0

  const { data: queued } = await supabaseAdmin
    .from('generation_jobs').select('id')
    .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued')
    .order('batch_index', { ascending: true })
    .limit(slots)

  const claimed: Array<{ id: string; brief: string; project_name: string | null }> = []
  for (const q of queued ?? []) {
    // created_at restarts at the claim: the in-flight / stale window measures the run, not the wait.
    const { data } = await supabaseAdmin
      .from('generation_jobs')
      .update({ status: 'running', phase: 'designing', created_at: new Date().toISOString() })
      .eq('id', q.id).eq('status', 'queued')
      .select('id, brief, project_name')
      .maybeSingle()
    if (data) claimed.push(data as { id: string; brief: string; project_name: string | null })
  }
  if (!claimed.length) return 0

  after(() => Promise.all(claimed.map(async (job) => {
    try {
      await runGeneration({
        jobId: job.id,
        userId,
        brief: job.brief,
        projectName: job.project_name ?? undefined,
        existingProjectId: undefined,
        agency: true,
        charged: false,
      })
    } catch (err) {
      console.error(`[batch] job ${job.id} crashed:`, err)
    }
    await chainKick(batchId)
  })))
  return claimed.length
}

/**
 * Production only: a finished job asks the kick endpoint (a fresh invocation with its own
 * 300 s) to start the next queued store. Previews and local dev rely on the page's polling.
 */
async function chainKick(batchId: string) {
  const secret = process.env.CRON_SECRET
  if (process.env.VERCEL_ENV !== 'production' || !secret) return
  try {
    await fetch(`${APP_ORIGIN}/api/quante/batch/${batchId}/kick`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    console.error(`[batch] chain kick for ${batchId} failed (the next poll restarts it):`, err)
  }
}

/** The batch's stores, in the order the merchant listed them. null = not this user's batch. */
export async function batchJobs(batchId: string, userId: string): Promise<BatchJob[] | null> {
  const { data, error } = await supabaseAdmin
    .from('generation_jobs')
    .select('id, project_name, status, phase, project_id, preview_url, error, deploy_error, created_at')
    .eq('batch_id', batchId).eq('user_id', userId)
    .order('batch_index', { ascending: true })
  if (error || !data || data.length === 0) return null
  return data.map((r) => ({
    id: r.id as string,
    name: (r.project_name as string | null) ?? null,
    status: r.status as BatchJobStatus,
    phase: (r.phase as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    previewUrl: (r.preview_url as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    deployError: (r.deploy_error as string | null) ?? null,
  }))
}

/** The user's batches from the last day, newest first (the dashboard banner). */
export async function recentBatches(userId: string): Promise<BatchSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('generation_jobs')
    .select('batch_id, status, created_at')
    .eq('user_id', userId).not('batch_id', 'is', null)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
  if (error || !data) return []
  const by = new Map<string, BatchSummary>()
  for (const r of data) {
    const id = r.batch_id as string
    const s = by.get(id) ?? { batchId: id, createdAt: r.created_at as string, total: 0, queued: 0, running: 0, completed: 0, failed: 0 }
    s.total++
    const st = r.status as BatchJobStatus
    if (st === 'queued' || st === 'running' || st === 'completed' || st === 'failed') s[st]++
    if ((r.created_at as string) < s.createdAt) s.createdAt = r.created_at as string
    by.set(id, s)
  }
  return [...by.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
