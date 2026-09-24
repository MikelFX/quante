// DB-backed attempt log for the Claude routes in /api/quante (iterate, fix, intake).
// Server-only. Table: quante_request_attempts (supabase/migration-security-iterate-fix-section.sql,
// columns executed_at + ip added by supabase/migration-security3-quante-credits.sql).
//
// SECURITY: limits must count requests when they START, not rows written after the
// Claude call finishes — otherwise N parallel requests all see count 0 and pass. Insert
// the attempt first, then count (including our own row): the k-th concurrent insert
// always sees >= k rows, so at most `limit` requests get through.

import { supabaseAdmin } from '@/lib/supabase/admin'

export type AttemptRoute = 'iterate' | 'fix' | 'intake'

// Anything older than this with finished_at still null is a crashed / killed
// invocation (maxDuration is 300s) and no longer counts as in flight.
const IN_FLIGHT_STALE_MS = 6 * 60_000

/** True when a PostgREST/Postgres error means the table itself does not exist. */
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export type StartAttemptResult =
  | { id: string; missingTable: false }
  | { id: null; missingTable: boolean }

/**
 * Records an attempt and says WHY it failed when it did: `missingTable` is true only when
 * quante_request_attempts does not exist (migration not run). Any other failure (a
 * transient DB error) has missingTable false, so callers that fall back to weaker limits
 * while the migration is pending can still fail closed on real errors.
 * `ip` (optional) enables per-IP counts; if the ip column does not exist yet
 * (migration-security3-quante-credits.sql not run) the row is still recorded without it,
 * so per-user limits keep working.
 */
export async function startAttemptDetailed(
  userId: string,
  route: AttemptRoute,
  refId: string | null,
  ip?: string | null,
): Promise<StartAttemptResult> {
  const row: Record<string, unknown> = { user_id: userId, route, ref_id: refId }
  if (ip) row.ip = ip
  let { data, error } = await supabaseAdmin.from('quante_request_attempts').insert(row).select('id').single()
  if ((error || !data) && ip && !isMissingTable(error)) {
    console.error('[attempts] insert with ip failed (run migration-security3-quante-credits.sql?):', error?.message)
    ;({ data, error } = await supabaseAdmin
      .from('quante_request_attempts')
      .insert({ user_id: userId, route, ref_id: refId })
      .select('id')
      .single())
  }
  if (error || !data) {
    console.error(`[attempts] insert failed (run migration-security-iterate-fix-section.sql?):`, error?.message)
    return { id: null, missingTable: isMissingTable(error) }
  }
  return { id: (data as { id: string }).id, missingTable: false }
}

/**
 * Records an attempt. Returns its id, or null if the log is unavailable (caller decides
 * fail-open/closed). See startAttemptDetailed.
 */
export async function startAttempt(
  userId: string,
  route: AttemptRoute,
  refId: string | null,
  ip?: string | null,
): Promise<string | null> {
  return (await startAttemptDetailed(userId, route, refId, ip)).id
}

export async function finishAttempt(id: string | null): Promise<void> {
  if (!id) return
  try {
    await supabaseAdmin.from('quante_request_attempts').update({ finished_at: new Date().toISOString() }).eq('id', id)
  } catch (err) {
    console.error('[attempts] finish failed:', err)
  }
}

/**
 * Marks an attempt as actually executed (every cap / precondition passed and the model
 * is being called). /api/credits/refund counts only executed fix attempts when deciding
 * whether the auto-fix loop was exhausted — attempts refused by a cap never ran (R2).
 * Returns false if the row could not be marked (e.g. column missing).
 */
export async function markAttemptExecuted(id: string | null): Promise<boolean> {
  if (!id) return false
  const { error } = await supabaseAdmin
    .from('quante_request_attempts').update({ executed_at: new Date().toISOString() }).eq('id', id)
  if (error) {
    console.error('[attempts] mark executed failed (run migration-security3-quante-credits.sql?):', error.message)
    return false
  }
  return true
}

/** Attempts by this user on `route` created in the last `windowMs`. null = lookup failed. */
export async function countRecentAttempts(userId: string, route: AttemptRoute, windowMs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { count, error } = await supabaseAdmin
    .from('quante_request_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('route', route).gte('created_at', since)
  if (error) { console.error('[attempts] count failed:', error.message); return null }
  return count ?? 0
}

/** Attempts from this IP (any user) on `route` in the last `windowMs`. null = lookup failed. */
export async function countRecentAttemptsByIp(ip: string, route: AttemptRoute, windowMs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { count, error } = await supabaseAdmin
    .from('quante_request_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip).eq('route', route).gte('created_at', since)
  if (error) { console.error('[attempts] ip count failed:', error.message); return null }
  return count ?? 0
}

/** Unfinished (still running) attempts by this user on `route`. null = lookup failed. */
export async function countInFlightAttempts(userId: string, route: AttemptRoute): Promise<number | null> {
  const since = new Date(Date.now() - IN_FLIGHT_STALE_MS).toISOString()
  const { count, error } = await supabaseAdmin
    .from('quante_request_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('route', route).is('finished_at', null).gte('created_at', since)
  if (error) { console.error('[attempts] in-flight count failed:', error.message); return null }
  return count ?? 0
}

/** All attempts on `route` for one ref (e.g. one failed deployment). null = lookup failed. */
export async function countAttemptsForRef(userId: string, route: AttemptRoute, refId: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from('quante_request_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('route', route).eq('ref_id', refId)
  if (error) { console.error('[attempts] ref count failed:', error.message); return null }
  return count ?? 0
}
