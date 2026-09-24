// Hosting paywall gate — the ONE place that decides whether a project may be
// deployed to production (its public <slug>.stores subdomain / custom domain).
// Server-only. getHostingGate is read-only: no side effects (starting the trial clock is
// the caller's job — claimHostingTrial, then an atomic `.is('hosting_trial_ends_at',
// null)` update; releaseHostingTrial undoes both when the first live deploy fails).
//
// Rules (mirrors /api/deploy, /api/cron/hosting and the hosting branch of
// /api/stripe/webhook):
//   - everLive  = hosting_trial_ends_at is set (stamped on the first live deploy).
//   - A hosting_subscriptions row with status active/trialing whose
//     current_period_end is in the future (or not yet known) → allowed, even if the
//     store is currently suspended (the webhook restores it; paying users must never
//     be locked out by a failed restore).
//   - Owner on an active Agency plan (lib/tier.ts) → allowed — but not while the owner
//     is on users.billing_hold (a charged-back Agency invoice, audit F2; isAgencyUser
//     answers false then, and on a hold-lookup error).
//   - hosting_suspended_at set (and none of the above) → NOT allowed.
//   - Never live yet → allowed only while the OWNER is still trial-eligible (this is
//     the first Push to Live; it starts the trial). The 30-day trial is once per user,
//     not per project (audit R7: deleting/recreating projects used to reset it): a user
//     who already has — or had, incl. soft-deleted 'deleted:<userId>' tombstones — any
//     other project with hosting_trial_ends_at set gets reason 'trial_used' and needs a
//     subscription (or Agency) to go live. /api/deploy then stamps
//     hosting_trial_ends_at = now for such a project (everLive, but no free trial).
//     A hosting_trials claim for another project also counts as used. The gate's
//     answer is only a pre-check: /api/deploy takes the trial with claimHostingTrial (a
//     per-user compare-and-set on hosting_trials, migration-security3-hosting.sql)
//     before it stamps, so concurrent first deploys of several projects cannot each
//     get one. Alias accounts sharing a normalized email / phone identity
//     (user_identities, migration-security4-identity-gate.sql) count as one user for
//     this (audit F0/F10). The identities are read from Clerk here, server-side, and
//     recorded by the claim itself — linkage does not depend on the welcome grant
//     having run. Once that migration has run, an account with no verified email /
//     phone gets no free trial (it could not be linked to its other accounts).
//   - Trial end in the future → allowed; otherwise NOT allowed.
//
// Callers that auto-deploy (iterate / fix / redeploy / restore) must additionally
// require `everLive` before deploying to production — only an explicit Push to Live
// (/api/deploy) may take a store live for the first time. Everything else uses a
// true preview deploy (createVercelPreviewDeploy).
//
// Fails closed: if the lookup errors, production deploys are refused.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { isAgencyUser } from '@/lib/tier'
import { isUuid } from '@/lib/auth/project'
// Shared with the welcome grant so both dedupe on exactly the same normalized, hashed
// identities (lower-case, +tag stripped, Gmail dots / googlemail.com folded, E.164).
import { verifiedIdentitiesForUserId } from '@/app/api/credits/welcome-grant'

export type HostingGateReason =
  | 'invalid_project'
  | 'project_not_found'
  | 'lookup_failed'
  | 'suspended'
  | 'trial_expired'
  | 'trial_used'

export interface HostingGate {
  everLive: boolean
  canDeployProduction: boolean
  reason?: HostingGateReason
  /** Extra context for callers/UI; not needed for the allow/deny decision. */
  suspended?: boolean
  trialEndsAt?: string | null
  hasActiveSubscription?: boolean
  /** True when the owner's active Agency plan is what allows production. */
  agency?: boolean
  /**
   * Only computed for never-live projects: true when the owner has not used their
   * one free hosting trial on any other project. undefined when not computed or the
   * lookup failed (callers must then NOT start a trial).
   */
  trialEligible?: boolean
}

// Stripe renews at period end and the customer.subscription.updated webhook that
// moves current_period_end forward can lag a little — don't cut a paying store off
// in that window.
const PERIOD_END_GRACE_MS = 48 * 60 * 60 * 1000

// Cap on identity-linked accounts considered per user (lookup size guard).
const MAX_LINKED_USERS = 50

// The read-only pre-check (hasUsedHostingTrial) runs on every never-live gate lookup
// (Studio page loads, iterate deploys); cache its Clerk read briefly per instance. The
// authoritative claimHostingTrial always reads Clerk fresh.
const IDENTITY_CACHE_TTL_MS = 60 * 1000
const IDENTITY_CACHE_MAX = 500
const identityCache = new Map<string, { at: number; ids: string[] }>()

async function clerkIdentities(userId: string, fresh: boolean): Promise<string[] | null> {
  const now = Date.now()
  if (!fresh) {
    const hit = identityCache.get(userId)
    if (hit && now - hit.at < IDENTITY_CACHE_TTL_MS) return hit.ids
  }
  const ids = await verifiedIdentitiesForUserId(userId)
  if (ids !== null) {
    if (identityCache.size >= IDENTITY_CACHE_MAX) identityCache.clear()
    identityCache.set(userId, { at: now, ids })
  }
  return ids
}

interface IdentityLinks {
  /** false while migration-security4-identity-gate.sql has not run (no user_identities). */
  active: boolean
  /** How many distinct identities `userId` is known by (Clerk now + stored). */
  identityCount: number
  /** Other Clerk users sharing one of them — alias accounts of the same person. */
  linked: string[]
}

/**
 * Other Clerk users that share a normalized identity (verified email / phone, see
 * app/api/credits/welcome-grant.ts) with `userId` — i.e. alias accounts of the same
 * person (audit F0/F10). The user's own identities are read from Clerk (server-side) and
 * unioned with those stored in user_identities, so this works even when this account
 * never ran the welcome grant; the OTHER accounts are found through user_identities
 * (written by the welcome grant, every trial claim and the one-time identity backfill).
 * { active: false } when the table does not exist yet; null when a lookup fails.
 */
async function identityLinks(userId: string): Promise<IdentityLinks | null> {
  const { data: own, error } = await supabaseAdmin
    .from('user_identities')
    .select('normalized_identity')
    .eq('user_id', userId)
    .limit(50)
  if (error) {
    if (isMissingTable(error)) return { active: false, identityCount: 0, linked: [] }
    console.error('[hosting/gate] identity lookup failed:', error.message)
    return null
  }
  const fromClerk = await clerkIdentities(userId, false)
  if (fromClerk === null) return null
  const identities = [...new Set([
    ...fromClerk,
    ...(own ?? []).map((r) => (r as { normalized_identity: string }).normalized_identity),
  ])]
  if (identities.length === 0) return { active: true, identityCount: 0, linked: [] }

  const { data: others, error: othersErr } = await supabaseAdmin
    .from('user_identities')
    .select('user_id')
    .in('normalized_identity', identities)
    .neq('user_id', userId)
    .limit(MAX_LINKED_USERS)
  if (othersErr) {
    console.error('[hosting/gate] linked-identity lookup failed:', othersErr.message)
    return null
  }
  const ids = new Set<string>()
  for (const r of others ?? []) {
    const id = (r as { user_id: string | null }).user_id
    if (id && !id.startsWith('deleted:')) ids.add(id)
  }
  return { active: true, identityCount: identities.length, linked: [...ids] }
}

/**
 * Has this user already used their one free hosting trial on a project other than
 * `excludeProjectId`? Soft-deleted projects keep hosting_trial_ends_at and are
 * tombstoned as user_id 'deleted:<userId>' (app/api/projects/[id] DELETE), so deleting
 * a store does not hand the trial back. A hosting_trials claim held by another project
 * also counts. So does any trial used by another account sharing a normalized identity
 * with this one (audit F0/F10 — alias accounts are one person). Returns null when a
 * lookup fails.
 */
export async function hasUsedHostingTrial(userId: string, excludeProjectId: string): Promise<boolean | null> {
  if (!userId || userId.startsWith('deleted:')) return null

  const links = await identityLinks(userId)
  if (links === null) return null
  const owners = [userId, ...links.linked]
  const ownerKeys = owners.flatMap((id) => [id, `deleted:${id}`])

  const { count, error } = await supabaseAdmin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .in('user_id', ownerKeys)
    .not('hosting_trial_ends_at', 'is', null)
    .neq('id', excludeProjectId)
  if (error) {
    console.error('[hosting/gate] trial-usage lookup failed:', error.message)
    return null
  }
  if ((count ?? 0) > 0) return true

  // Same rule as claim_hosting_trial_v2: no verified identity → no free trial.
  const unverified = links.active && links.identityCount === 0

  // The per-user claim (see claimHostingTrial). Before the migration has run the table
  // does not exist; the projects scan above is then the only record.
  const { data: claims, error: claimErr } = await supabaseAdmin
    .from('hosting_trials')
    .select('user_id, project_id')
    .in('user_id', owners)
  if (claimErr) {
    if (isMissingTable(claimErr)) return unverified
    console.error('[hosting/gate] trial-claim lookup failed:', claimErr.message)
    return null
  }
  const rows = (claims ?? []) as { user_id: string; project_id: string | null }[]
  // A linked account's claim always counts; our own only when it is for another project.
  if (rows.some((c) => c.user_id !== userId || c.project_id !== excludeProjectId)) return true
  // Our own claim for THIS project (claim_hosting_trial_v2 checks it first, too).
  if (rows.some((c) => c.user_id === userId && c.project_id === excludeProjectId)) return false
  return unverified
}

// 42P01 = undefined_table (Postgres); PGRST205 = table not in PostgREST's schema cache.
// Either means the migration that creates the table has not been run yet.
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

// PGRST202 = function not in PostgREST's schema cache; 42883 = undefined_function.
function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

export type HostingTrialClaim =
  /** This project now holds (or already held) the user's one free trial. */
  | 'claimed'
  /** Another project already holds it — no free trial for this one. */
  | 'used'
  /** hosting_trials does not exist yet (migration not run) — fall back to hasUsedHostingTrial. */
  | 'unavailable'
  /** Lookup/insert failed — the caller must not start a trial. */
  | 'error'

/**
 * Atomically takes the user's one free hosting trial for `projectId` (audit R7). A
 * primary key on hosting_trials.user_id makes this a per-user compare-and-set: of N
 * concurrent first deploys on different projects exactly one gets 'claimed'.
 * Callers MUST have verified the caller owns `projectId`.
 */
export async function claimHostingTrial(userId: string, projectId: string): Promise<HostingTrialClaim> {
  if (!userId || userId.startsWith('deleted:') || !isUuid(projectId)) return 'error'

  // Identity-aware claim (audit F0/F10, migration-security4-identity-gate.sql): the same
  // per-user compare-and-set, plus 'used' when an alias account sharing a normalized
  // identity already took a trial — serialised per identity in the database, so two
  // alias accounts cannot claim concurrently. The identities come from Clerk, read fresh
  // here (never from the request), and the RPC records them before its sibling check, so
  // an alias that never ran the welcome grant (projects → manifest/save → deploy) is
  // still linked. Fails closed if Clerk cannot be read. Falls through to the plain
  // per-user insert below until that migration has run.
  const identities = await clerkIdentities(userId, true)
  if (identities === null) return 'error'
  const { data: v2, error: v2Err } = await supabaseAdmin.rpc('claim_hosting_trial_v2', {
    p_user_id: userId,
    p_project_id: projectId,
    p_identities: identities,
  })
  if (!v2Err && v2) {
    const d = v2 as { ok?: boolean; status?: string }
    if (d.ok && d.status === 'claimed') return 'claimed'
    if (d.ok && d.status === 'used') return 'used'
    console.error('[hosting/gate] claim_hosting_trial_v2 returned an unexpected result:', JSON.stringify(d))
    return 'error'
  }
  if (v2Err && !isMissingFunction(v2Err) && !isMissingTable(v2Err)) {
    console.error('[hosting/gate] claim_hosting_trial_v2 failed:', v2Err.message)
    return 'error'
  }

  const { error } = await supabaseAdmin
    .from('hosting_trials')
    .insert({ user_id: userId, project_id: projectId })
  if (!error) return 'claimed'
  if (isMissingTable(error)) {
    console.warn('[hosting/gate] hosting_trials missing — run supabase/migration-security3-hosting.sql')
    return 'unavailable'
  }
  if (error.code !== '23505') {
    console.error('[hosting/gate] trial claim failed:', error.message)
    return 'error'
  }

  // Unique violation: the user already has a claim. It is ours only if it is for this
  // same project (e.g. a concurrent Push to Live of this project took it first).
  const { data, error: readErr } = await supabaseAdmin
    .from('hosting_trials')
    .select('project_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (readErr) {
    console.error('[hosting/gate] trial claim re-read failed:', readErr.message)
    return 'error'
  }
  return (data as { project_id: string | null } | null)?.project_id === projectId ? 'claimed' : 'used'
}

/**
 * Undoes a first live deploy's trial bookkeeping when that deploy never produced a live
 * store (the Vercel deployment could not be created, or its build failed/was canceled):
 *   - `stampedTrialEndsAt` given → clears projects.hosting_trial_ends_at, but only while
 *     it still holds exactly that value (compare-and-set; a later stamp is kept) and the
 *     store is not suspended. Nothing else happens if that reset does not apply.
 *   - then deletes this project's hosting_trials claim (if any), so the user keeps
 *     their one free trial. Another project's claim is never touched.
 * Callers MUST have verified that nothing from this project is live. Returns true when
 * the bookkeeping was released.
 */
export async function releaseHostingTrial(
  userId: string,
  projectId: string,
  stampedTrialEndsAt: string | null,
): Promise<boolean> {
  if (!userId || userId.startsWith('deleted:') || !isUuid(projectId)) return false

  if (stampedTrialEndsAt) {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ hosting_trial_ends_at: null })
      .eq('id', projectId)
      .eq('user_id', userId)
      .eq('hosting_trial_ends_at', stampedTrialEndsAt)
      .is('hosting_suspended_at', null)
      .select('id')
    if (error) {
      console.error('[hosting/gate] trial stamp reset failed:', error.message)
      return false
    }
    if (!data || data.length === 0) return false
  }

  const { error: delErr } = await supabaseAdmin
    .from('hosting_trials')
    .delete()
    .eq('user_id', userId)
    .eq('project_id', projectId)
  if (delErr && !isMissingTable(delErr)) {
    // The project is never-live again; a leftover claim for it still lets THIS project
    // re-claim (claimHostingTrial treats a claim for the same project as ours).
    console.error('[hosting/gate] trial claim release failed:', delErr.message)
  }
  return true
}

export async function getHostingGate(projectId: string): Promise<HostingGate> {
  if (!isUuid(projectId)) {
    return { everLive: false, canDeployProduction: false, reason: 'invalid_project' }
  }

  const { data: project, error } = await supabaseAdmin
    .from('projects')
    .select('id, user_id, hosting_trial_ends_at, hosting_suspended_at')
    .eq('id', projectId)
    .maybeSingle()

  if (error) {
    console.error('[hosting/gate] project lookup failed:', error.message)
    return { everLive: false, canDeployProduction: false, reason: 'lookup_failed' }
  }
  if (!project) {
    return { everLive: false, canDeployProduction: false, reason: 'project_not_found' }
  }

  const row = project as {
    user_id: string
    hosting_trial_ends_at: string | null
    hosting_suspended_at: string | null
  }
  const trialEndsAt = row.hosting_trial_ends_at ?? null
  const everLive = !!trialEndsAt
  const suspended = !!row.hosting_suspended_at
  const now = Date.now()

  // Trial eligibility only matters before the first live deploy.
  let trialEligible: boolean | undefined
  let trialLookupFailed = false
  if (!everLive) {
    const used = await hasUsedHostingTrial(row.user_id, projectId)
    if (used === null) trialLookupFailed = true
    else trialEligible = !used
  }

  const { data: subs, error: subErr } = await supabaseAdmin
    .from('hosting_subscriptions')
    .select('status, current_period_end')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing'])

  if (subErr) {
    console.error('[hosting/gate] subscription lookup failed:', subErr.message)
    return { everLive, canDeployProduction: false, reason: 'lookup_failed', suspended, trialEndsAt }
  }

  const hasActiveSubscription = (subs ?? []).some((s) => {
    const end = (s as { current_period_end: string | null }).current_period_end
    // A null period end means Stripe didn't send it on this API version; the status
    // (kept current by the webhook) is then authoritative.
    if (!end) return true
    const endMs = new Date(end).getTime()
    return Number.isFinite(endMs) && endMs + PERIOD_END_GRACE_MS > now
  })

  const base = { everLive, suspended, trialEndsAt, hasActiveSubscription, trialEligible }

  if (hasActiveSubscription) return { ...base, canDeployProduction: true }

  let agency = false
  try {
    agency = await isAgencyUser(row.user_id)
  } catch (err) {
    console.error('[hosting/gate] agency lookup failed:', err)
  }
  if (agency) return { ...base, agency: true, canDeployProduction: true }

  if (suspended) return { ...base, canDeployProduction: false, reason: 'suspended' }

  if (!everLive) {
    if (trialLookupFailed) return { ...base, canDeployProduction: false, reason: 'lookup_failed' }
    if (trialEligible) return { ...base, canDeployProduction: true }
    return { ...base, canDeployProduction: false, reason: 'trial_used' }
  }

  const trialEndMs = new Date(trialEndsAt as string).getTime()
  if (Number.isFinite(trialEndMs) && trialEndMs > now) {
    return { ...base, canDeployProduction: true }
  }
  return { ...base, canDeployProduction: false, reason: 'trial_expired' }
}
