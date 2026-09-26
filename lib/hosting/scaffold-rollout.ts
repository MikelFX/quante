// Automatic store scaffold rollout. Server-only.
//
// Hosted stores are built from the platform-owned scaffold (buildCodeGenScaffold + the
// LOCKED files in lib/store-template/build.ts) plus the merchant's AI files
// (code_versions.files). When the scaffold changes, SCAFFOLD_VERSION is bumped and every
// LIVE store is rebuilt with the new scaffold:
//   - from the code version that is LIVE in production right now (never the latest
//     draft — unpublished edits must not be published by a platform update);
//   - for free (no credits; the hosting gate must still allow production);
//   - without breaking stores: the rollout is a production-target Vercel deployment. If
//     its build fails, Vercel keeps serving the previous production deployment, so the
//     store stays online on the old scaffold; the failure is recorded
//     (projects.scaffold_update_error) and retried up to MAX_SCAFFOLD_UPDATE_ATTEMPTS
//     times by the cron / admin batch.
// Entry points: /api/cron/scaffold-rollout (daily), /api/admin/scaffold-rollout
// (Admin → Store updates), /api/projects/[id]/scaffold-update (owner, Studio banner),
// /api/projects/[id]/scaffold-status (owner, DB-only).
// Needs supabase/migration-scaffold-version.sql; until it has run everything here answers
// 'migration_pending' and deploys nothing.
//
// Known race (accepted, narrow): if the owner publishes a chat edit (production build Y)
// while a rollout build X of the previously live version is still building, and Y turns
// READY before X, Vercel may alias X last and serve the older content until the next
// publish. updateStoreScaffold refuses to start while any fresh production build of the
// store is in progress ('building'), which closes the reverse order; the remaining window
// is the few minutes of X's build.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import { getHostingGate } from '@/lib/hosting/gate'
import {
  HOSTING_ROOT_DOMAIN,
  attachDomain,
  createPreviewDeployment,
  ensureProjectVercel,
  getBuildError,
  getDeploymentStatus,
  getOrClaimStoreSlug,
} from '@/lib/hosting/vercel'
import { insertDeploymentRow, isUnknownColumnError } from '@/lib/hosting/deployments'
import { platformApiUrl, ensureStoreApiKey, setStoreConnectionEnv } from '@/lib/hosting/store-env'
import { buildStoreFiles, filterAiStoreFiles, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import type { CodeVersionFiles } from '@/types/store-code'
import {
  type RolloutDeploymentRow,
  type ScaffoldEvaluation,
  ambiguousRowsToResolve,
  evaluateScaffoldState,
  isAttemptCapped,
  isProductionRow,
  outdatedSkipReason,
  projectSyncPatch,
  rowScaffoldVersion,
  rowsNeedingSettle,
  MAX_SCAFFOLD_UPDATE_ATTEMPTS,
} from '@/lib/hosting/scaffold-rollout-rules'

export { SCAFFOLD_VERSION, MAX_SCAFFOLD_UPDATE_ATTEMPTS }

// ─── Types ────────────────────────────────────────────────────────────────────

export type RolloutTrigger = 'admin' | 'cron' | 'owner'

export type RolloutSkipReason =
  | 'migration_pending'
  | 'lookup_failed'
  | 'project_not_found'
  | 'not_live'
  | 'suspended'
  | 'hosting_inactive'
  | 'attempts_exhausted'
  | 'no_live_version'
  | 'up_to_date'
  | 'already_building'
  | 'in_progress'
  | 'platform_url_missing'

export interface RolloutResult {
  projectId: string
  status: 'started' | 'skipped' | 'failed'
  reason?: RolloutSkipReason | 'error'
  error?: string
  deploymentId?: string
  url?: string
  /** Code version rebuilt (the one live in production). */
  codeVersionId?: string
  /** Scaffold version of the live build before this update. */
  fromScaffoldVersion?: number | null
  toScaffoldVersion?: number
  /** AI files of the live version dropped by the current AI file filter. */
  droppedFiles?: Array<{ path: string; reason: string }>
}

export interface RolloutProject {
  id: string
  name: string | null
  user_id: string
  status: string | null
  vercel_project_id: string | null
  hosting_trial_ends_at: string | null
  hosting_suspended_at: string | null
  scaffold_version: number | null
  scaffold_update_attempts: number | null
  scaffold_update_error: string | null
  scaffold_update_at: string | null
}

class MigrationPendingError extends Error {}
class LookupError extends Error {}

const PROJECT_COLUMNS =
  'id, name, user_id, status, vercel_project_id, hosting_trial_ends_at, hosting_suspended_at, ' +
  'scaffold_version, scaffold_update_attempts, scaffold_update_error, scaffold_update_at'
const DEPLOYMENT_COLUMNS =
  'id, vercel_project_id, vercel_deployment_id, status, created_at, code_version_id, domain, url, ' +
  'target, scaffold_version, rollout_trigger'

// Rows scanned per project to find the live production build.
const ROW_LOOKBACK = 30
// Vercel lookups one evaluation may spend settling stale 'building' production rows /
// resolving legacy rows of unknown target. Progress is persisted, so a store with more
// such rows advances by this many per evaluation.
const MAX_SETTLE_LOOKUPS = 5
const MAX_AMBIGUOUS_LOOKUPS = 5
// A trigger within this window of the previous one is treated as concurrent.
const TRIGGER_LOCK_MS = 2 * 60 * 1000
// After a build was started but its deployments row could not be written, block new
// triggers of that store for this long (the row-based throttles can't see that build).
const UNRECORDED_BUILD_LOCK_MS = 60 * 60 * 1000
// reconcileRolloutDeployments() looks at builds created within this window. The cron
// runs daily, so this must cover more than a day (builds the previous run started).
const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000
const MAX_ERROR_CHARS = 2000

const STORE_HOST_SUFFIX = `.${HOSTING_ROOT_DOMAIN.toLowerCase().replace(/^\.+/, '')}`

// ─── Loading + settling ───────────────────────────────────────────────────────

async function loadProject(projectId: string): Promise<RolloutProject | null> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('id', projectId)
    .maybeSingle()
  if (error) {
    if (isUnknownColumnError(error)) throw new MigrationPendingError(error.message)
    throw new LookupError(`project ${projectId}: ${error.message}`)
  }
  return (data as unknown as RolloutProject | null) ?? null
}

async function loadDeploymentRows(projectId: string): Promise<RolloutDeploymentRow[]> {
  // Only rows that can be (or become) the live build: production + legacy rows of
  // unknown target. Draft ('staged') and preview builds are excluded so a run of
  // unpublished chat edits can't push the live row out of the lookback window.
  const query = (columns: string) => supabaseAdmin
    .from('deployments')
    .select(columns)
    .eq('project_id', projectId)
    .or('target.is.null,target.eq.production')
    .order('created_at', { ascending: false })
    .limit(ROW_LOOKBACK)
  let { data, error } = await query(`${DEPLOYMENT_COLUMNS}, promoted_at`)
  // Before migration-draft-publish.sql there is no promoted_at (nothing was promoted).
  if (error && isUnknownColumnError(error)) ({ data, error } = await query(DEPLOYMENT_COLUMNS))
  if (error) {
    if (isUnknownColumnError(error)) throw new MigrationPendingError(error.message)
    throw new LookupError(`deployments of ${projectId}: ${error.message}`)
  }
  return (data ?? []) as unknown as RolloutDeploymentRow[]
}

function vercelStatusCode(err: unknown): number | undefined {
  const code = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof code === 'number' ? code : undefined
}

/** SQL filter: the project's recorded scaffold_version is older than the current one. */
const STALE_PROJECT_VERSION = `scaffold_version.is.null,scaffold_version.lt.${SCAFFOLD_VERSION}`

/**
 * Writes a settled Vercel state back to a deployments row, and records on the project:
 *   - READY production build at the current scaffold version → store is up to date
 *     (scaffold_version, attempts reset, error cleared) — whoever started the build;
 *   - failed ROLLOUT build → projects.scaffold_update_error (build log excerpt). Failed
 *     builds of the owner's own edits are not rollout failures and are not recorded.
 */
async function applySettledState(
  projectId: string,
  row: RolloutDeploymentRow,
  state: 'ready' | 'error' | 'canceled',
  errorMessage: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: state, updated_at: now }
  if (state !== 'ready' && errorMessage) update.error_message = errorMessage.slice(0, MAX_ERROR_CHARS)
  // Same as the ready transition in GET /api/deploy: a Push to Live deployment gets its
  // subdomain attached only there, and a row settled here would skip that step. Only
  // our own store subdomains are attached (restore rows can carry a raw
  // <deployment>.vercel.app host as `domain` — never add that as a project domain);
  // clear `domain` when the subdomain is not ours.
  const domain = row.domain?.toLowerCase() ?? null
  if (state === 'ready' && domain && domain.endsWith(STORE_HOST_SUFFIX) && row.vercel_project_id) {
    try {
      await attachDomain(row.vercel_project_id, domain)
      update.url = `https://${domain}`
    } catch (err) {
      console.error('[scaffold-rollout] attachDomain failed — subdomain unavailable for this project:', (err as Error)?.message ?? err)
      update.domain = null
    }
  }
  const { error } = await supabaseAdmin
    .from('deployments')
    .update(update)
    .eq('id', row.id)
    .in('status', ['building', 'queued'])
  if (error) console.error('[scaffold-rollout] deployment status write-back failed:', error.message)

  if (!isProductionRow(row) || rowScaffoldVersion(row) < SCAFFOLD_VERSION) return
  if (state === 'ready') {
    const { error: projErr } = await supabaseAdmin
      .from('projects')
      .update({ scaffold_version: SCAFFOLD_VERSION, scaffold_update_attempts: 0, scaffold_update_error: null })
      .eq('id', projectId)
    if (projErr) console.error('[scaffold-rollout] project rollout state write failed:', projErr.message)
  } else if (row.rollout_trigger) {
    const { error: projErr } = await supabaseAdmin
      .from('projects')
      .update({ scaffold_update_error: (errorMessage ?? `Build ${state}.`).slice(0, MAX_ERROR_CHARS) })
      .eq('id', projectId)
      .or(STALE_PROJECT_VERSION)
    if (projErr) console.error('[scaffold-rollout] project rollout error write failed:', projErr.message)
  }
}

/**
 * Legacy rows (no `target`) with domain null and a raw *.vercel.app URL are either true
 * previews or production builds whose subdomain attach failed. When one is newer than
 * the live build candidate, ask Vercel for its real target and persist it, so the
 * rollout can't pick an OLDER production build as "live" and roll content back. Fails
 * closed (LookupError) when a target can't be confirmed or more rows remain than one
 * evaluation may look up (the resolved ones are saved; the next evaluation continues).
 */
async function resolveAmbiguousRows(projectId: string, rows: RolloutDeploymentRow[]): Promise<RolloutDeploymentRow[]> {
  const candidates = ambiguousRowsToResolve(rows, MAX_AMBIGUOUS_LOOKUPS + 1)
  if (candidates.length === 0) return rows

  const resolved = new Map<string, string>()
  for (const r of candidates.slice(0, MAX_AMBIGUOUS_LOOKUPS)) {
    let target: string
    try {
      const status = await getDeploymentStatus(r.vercel_deployment_id as string)
      target = status.target === 'production' ? 'production' : 'preview'
    } catch (err) {
      if (vercelStatusCode(err) === 404) {
        // Gone from Vercel — can't be what the store serves. In memory only.
        resolved.set(r.id, 'preview')
        continue
      }
      throw new LookupError(`Vercel target of ${r.vercel_deployment_id}: ${(err as Error)?.message ?? err}`)
    }
    resolved.set(r.id, target)
    const { error } = await supabaseAdmin
      .from('deployments')
      .update({ target })
      .eq('id', r.id)
      .is('target', null)
    if (error) console.error('[scaffold-rollout] deployment target write-back failed:', error.message)
  }
  if (candidates.length > MAX_AMBIGUOUS_LOOKUPS) {
    throw new LookupError(`more legacy deployments of unknown target for ${projectId} — continuing next run`)
  }
  return rows.map((r) => (resolved.has(r.id) ? { ...r, target: resolved.get(r.id) as string } : r))
}

/**
 * Confirms production rows the DB still shows as building/queued with Vercel (newest
 * first, only those newer than the newest READY production row) and writes settled
 * states back. Stops at the first one that turned READY (older rows can't be live).
 * Fails closed (LookupError) when a status can't be confirmed, or when more such rows
 * remain than one evaluation may look up and none of the looked-up ones is READY —
 * guessing could pick an older build as "live" and roll the store's content back. The
 * settled rows are saved, so the next evaluation continues where this one stopped.
 */
async function settleProductionRows(projectId: string, rows: RolloutDeploymentRow[]): Promise<RolloutDeploymentRow[]> {
  const candidates = rowsNeedingSettle(rows, MAX_SETTLE_LOOKUPS + 1)
  if (candidates.length === 0) return rows

  const settled = new Map<string, string>()
  let foundReady = false
  for (const r of candidates.slice(0, MAX_SETTLE_LOOKUPS)) {
    let state: string
    try {
      state = (await getDeploymentStatus(r.vercel_deployment_id as string)).state
    } catch (err) {
      if (vercelStatusCode(err) === 404) {
        state = 'error' // the deployment no longer exists on Vercel
      } else {
        throw new LookupError(`Vercel status of ${r.vercel_deployment_id}: ${(err as Error)?.message ?? err}`)
      }
    }
    if (state === 'ready' || state === 'error' || state === 'canceled') {
      settled.set(r.id, state)
      const msg = state === 'error' ? await getBuildError(r.vercel_deployment_id as string) : null
      await applySettledState(projectId, r, state, msg)
      if (state === 'ready') {
        foundReady = true
        break
      }
    }
  }
  if (!foundReady && candidates.length > MAX_SETTLE_LOOKUPS) {
    throw new LookupError(`more unsettled production builds for ${projectId} — continuing next run`)
  }
  return rows.map((r) => (settled.has(r.id) ? { ...r, status: settled.get(r.id) as string } : r))
}

/**
 * Loads the project's deployment rows and evaluates its scaffold state.
 *   settle: true  → resolves legacy rows of unknown target and settles stale in-progress
 *                   production rows with Vercel first (needed before REDEPLOYING).
 *   settle: false → DB only (status display / summary). Unresolved legacy rows count as
 *                   not production; they are all pre-versioning (v1) builds, so the
 *                   outdated / up-to-date answer is the same — only the live code version
 *                   could differ, and nothing is deployed from a DB-only evaluation.
 */
async function evaluateProject(
  projectId: string,
  opts: { settle: boolean },
): Promise<{ rows: RolloutDeploymentRow[]; evaluation: ScaffoldEvaluation }> {
  let rows = await loadDeploymentRows(projectId)
  if (opts.settle) {
    rows = await resolveAmbiguousRows(projectId, rows)
    rows = await settleProductionRows(projectId, rows)
  }
  const evaluation = evaluateScaffoldState(rows, { currentVersion: SCAFFOLD_VERSION })
  return { rows, evaluation }
}

/** Up to date but the project row still carries rollout state → clear it. */
async function syncProjectState(project: RolloutProject, evaluation: ScaffoldEvaluation): Promise<void> {
  const patch = projectSyncPatch(project, evaluation)
  if (!patch) return
  const { error } = await supabaseAdmin.from('projects').update(patch).eq('id', project.id)
  if (error) console.error('[scaffold-rollout] project state sync failed:', error.message)
  else Object.assign(project, patch)
}

/**
 * The code version currently LIVE in production (the newest READY production build's
 * code_version_id), or null ('no_live_version') — never the latest draft.
 */
export async function resolveLiveCodeVersion(
  projectId: string,
): Promise<{ codeVersionId: string | null; reason?: 'no_live_version' }> {
  const { evaluation } = await evaluateProject(projectId, { settle: true })
  const id = evaluation.liveRow?.code_version_id ?? null
  return id ? { codeVersionId: id } : { codeVersionId: null, reason: 'no_live_version' }
}

// ─── Status (owner Studio banner) ─────────────────────────────────────────────

export interface ScaffoldStatus {
  outdated: boolean
  currentVersion: number
  liveVersion: number | null
  building: boolean
  buildingDeploymentId: string | null
  lastError: string | null
  canUpdate: boolean
  reason?: RolloutSkipReason
  attempts: number
}

function baseStatus(extra: Partial<ScaffoldStatus>): ScaffoldStatus {
  return {
    outdated: false,
    currentVersion: SCAFFOLD_VERSION,
    liveVersion: null,
    building: false,
    buildingDeploymentId: null,
    lastError: null,
    canUpdate: false,
    attempts: 0,
    ...extra,
  }
}

function eligibilityReason(project: RolloutProject): RolloutSkipReason | null {
  if (project.status === 'deleted' || project.user_id.startsWith('deleted:')) return 'project_not_found'
  if (!project.hosting_trial_ends_at || !project.vercel_project_id) return 'not_live'
  if (project.hosting_suspended_at) return 'suspended'
  return null
}

/**
 * Scaffold state of one project — DB only (no Vercel calls, no writes), so the Studio
 * can call it on every load. Stale in-progress rows are not settled here: a store may
 * briefly show "update available" when a finished-but-unpolled build already made it
 * current; updateStoreScaffold() settles properly and answers 'up_to_date' then.
 * Callers must have verified access (owner / admin).
 */
export async function getScaffoldStatus(projectId: string, opts: { checkGate?: boolean } = {}): Promise<ScaffoldStatus> {
  try {
    const project = await loadProject(projectId)
    if (!project) return baseStatus({ reason: 'project_not_found' })
    const attempts = project.scaffold_update_attempts ?? 0
    const notEligible = eligibilityReason(project)
    if (notEligible) return baseStatus({ reason: notEligible, attempts })

    const { evaluation } = await evaluateProject(projectId, { settle: false })
    const common = {
      liveVersion: evaluation.liveScaffoldVersion,
      lastError: project.scaffold_update_error ?? null,
      attempts,
    }
    if (evaluation.state === 'building') {
      return baseStatus({
        ...common,
        building: true,
        buildingDeploymentId: evaluation.buildingRow?.vercel_deployment_id ?? null,
        reason: 'already_building',
      })
    }
    if (evaluation.state === 'no_live_version') return baseStatus({ ...common, reason: 'no_live_version' })
    if (evaluation.state === 'up_to_date') return baseStatus({ ...common, lastError: null, reason: 'up_to_date' })

    // Outdated.
    if (!evaluation.liveRow?.code_version_id) return baseStatus({ ...common, outdated: true, reason: 'no_live_version' })
    if (!platformApiUrl()) return baseStatus({ ...common, outdated: true, reason: 'platform_url_missing' })
    if (opts.checkGate !== false) {
      const gate = await getHostingGate(projectId)
      if (gate.reason === 'lookup_failed') return baseStatus({ ...common, outdated: true, reason: 'lookup_failed' })
      if (!gate.everLive || !gate.canDeployProduction) {
        return baseStatus({ ...common, outdated: true, reason: 'hosting_inactive' })
      }
    }
    return baseStatus({ ...common, outdated: true, canUpdate: true })
  } catch (err) {
    if (err instanceof MigrationPendingError) return baseStatus({ reason: 'migration_pending' })
    console.error('[scaffold-rollout] status lookup failed:', err)
    return baseStatus({ reason: 'lookup_failed' })
  }
}

// ─── Finding outdated stores ──────────────────────────────────────────────────

export interface OutdatedStore {
  projectId: string
  name: string | null
  ownerId: string
  liveVersion: number | null
  attempts: number
  lastError: string | null
  /** Set when the store is outdated but will not be updated by a batch run. */
  skipReason?: RolloutSkipReason
}

export interface FindOutdatedResult {
  migrationPending?: boolean
  /** Outdated stores a batch run would update (≤ limit). */
  stores: OutdatedStore[]
  /** Outdated stores a batch run skips (attempt cap, no live version, hosting not active, lookup failure). */
  skipped: OutdatedStore[]
  counts: { scanned: number; upToDate: number; outdated: number; building: number; failed: number; skipped: number }
  /** Pass back as `cursor` to continue; null when the whole table was scanned. */
  nextCursor: string | null
}

const PAGE_SIZE = 50

/**
 * Scans live projects (trial stamped, not deleted, has a Vercel project, not suspended)
 * in id order from `cursor`, evaluating each. Collects up to `limit` updatable outdated
 * stores (stops scanning then) and reports skipped ones — a store that can't be updated
 * (no live code version, attempt cap, hosting inactive) never takes a batch slot.
 * `projectIds` restricts the scan. `deadlineMs` (epoch ms) stops early with a cursor.
 * `light` = DB only (no Vercel settle / resolve, no hosting-gate lookups, no writes) for
 * the admin summary; its counts are approximate.
 */
export async function findOutdatedStores(opts: {
  limit: number
  cursor?: string | null
  projectIds?: string[]
  deadlineMs?: number
  /** Include stores over the attempt cap in `stores` (admin with explicit ids). */
  ignoreAttemptCap?: boolean
  /** Scan everything even after `limit` stores were found (summary counts). */
  scanAll?: boolean
  light?: boolean
}): Promise<FindOutdatedResult> {
  const result: FindOutdatedResult = {
    stores: [],
    skipped: [],
    counts: { scanned: 0, upToDate: 0, outdated: 0, building: 0, failed: 0, skipped: 0 },
    nextCursor: null,
  }
  const ids = opts.projectIds?.filter(isUuid)
  let after = opts.cursor && isUuid(opts.cursor) ? opts.cursor : null
  const light = !!opts.light

  for (;;) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
      result.nextCursor = after
      return result
    }
    let q = supabaseAdmin
      .from('projects')
      .select(PROJECT_COLUMNS)
      .not('hosting_trial_ends_at', 'is', null)
      .not('vercel_project_id', 'is', null)
      .is('hosting_suspended_at', null)
      .neq('status', 'deleted')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (after) q = q.gt('id', after)
    if (ids) q = q.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
    const { data, error } = await q
    if (error) {
      if (isUnknownColumnError(error)) return { ...result, migrationPending: true }
      throw new Error(`[scaffold-rollout] projects page failed: ${error.message}`)
    }
    const page = (data ?? []) as unknown as RolloutProject[]
    if (page.length === 0) return result

    for (const project of page) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
        result.nextCursor = after
        return result
      }
      after = project.id
      if (project.user_id.startsWith('deleted:')) continue
      result.counts.scanned++

      let evaluation: ScaffoldEvaluation
      try {
        evaluation = (await evaluateProject(project.id, { settle: !light })).evaluation
      } catch (err) {
        if (err instanceof MigrationPendingError) return { ...result, migrationPending: true }
        console.error(`[scaffold-rollout] evaluation failed for ${project.id}:`, err)
        result.counts.skipped++
        result.skipped.push({ ...storeEntry(project, null), skipReason: 'lookup_failed' })
        continue
      }
      // Builds settled elsewhere (Studio poll, log stream) never touch `projects`: clear
      // attempts / stale version here so they don't pile up across successful updates.
      if (!light) await syncProjectState(project, evaluation)
      const entry = storeEntry(project, evaluation.liveScaffoldVersion)

      if (evaluation.state === 'building') { result.counts.building++; continue }
      if (evaluation.state === 'up_to_date') { result.counts.upToDate++; continue }
      if (evaluation.state === 'no_live_version') {
        result.counts.skipped++
        result.skipped.push({ ...entry, skipReason: 'no_live_version' })
        continue
      }

      result.counts.outdated++
      if (entry.lastError) result.counts.failed++
      const skipReason = outdatedSkipReason(evaluation, project, { ignoreAttemptCap: opts.ignoreAttemptCap })
      if (skipReason) {
        result.counts.skipped++
        result.skipped.push({ ...entry, skipReason })
        continue
      }
      if (!light) {
        const gate = await getHostingGate(project.id)
        if (!gate.everLive || !gate.canDeployProduction) {
          result.counts.skipped++
          result.skipped.push({ ...entry, skipReason: gate.reason === 'lookup_failed' ? 'lookup_failed' : 'hosting_inactive' })
          continue
        }
      }
      if (result.stores.length < opts.limit) result.stores.push(entry)
      if (result.stores.length >= opts.limit && !opts.scanAll) {
        result.nextCursor = project.id
        return result
      }
    }
    if (page.length < PAGE_SIZE) return result
  }
}

function storeEntry(project: RolloutProject, liveVersion: number | null): OutdatedStore {
  return {
    projectId: project.id,
    name: project.name,
    ownerId: project.user_id,
    liveVersion,
    attempts: project.scaffold_update_attempts ?? 0,
    lastError: project.scaffold_update_error ?? null,
  }
}

// ─── Updating one store ───────────────────────────────────────────────────────

/**
 * Rebuilds one live store's LIVE code version with the current scaffold and deploys it
 * to production (subdomain attached; custom domains stay attached to the Vercel project
 * and follow the new production deployment). Free. Callers must have verified access
 * (owner via getOwnedProject, admin via requireAdmin, or the cron secret).
 *
 * If the Vercel build fails, Vercel keeps serving the previous production deployment —
 * the store stays online on the old scaffold. reconcileRolloutDeployments() (or anyone
 * polling the deployment) records the outcome.
 */
export async function updateStoreScaffold(
  projectId: string,
  opts: { trigger: RolloutTrigger; ignoreAttemptCap?: boolean },
): Promise<RolloutResult> {
  const skip = (reason: RolloutSkipReason, extra: Partial<RolloutResult> = {}): RolloutResult =>
    ({ projectId, status: 'skipped', reason, ...extra })
  const tag = `[scaffold-rollout:${opts.trigger}]`

  if (!isUuid(projectId)) return skip('project_not_found')

  let project: RolloutProject | null
  try {
    project = await loadProject(projectId)
  } catch (err) {
    if (err instanceof MigrationPendingError) return skip('migration_pending')
    console.error(`${tag} project lookup failed:`, err)
    return skip('lookup_failed')
  }
  if (!project) return skip('project_not_found')
  const notEligible = eligibilityReason(project)
  if (notEligible) return skip(notEligible)
  if (!opts.ignoreAttemptCap && isAttemptCapped(project)) return skip('attempts_exhausted')

  const gate = await getHostingGate(projectId)
  if (gate.reason === 'lookup_failed') return skip('lookup_failed')
  if (!gate.everLive || !gate.canDeployProduction) return skip('hosting_inactive')

  const appUrl = platformApiUrl()
  if (!appUrl) {
    console.error(`${tag} NEXT_PUBLIC_APP_URL is missing or not https — refusing to deploy`)
    return skip('platform_url_missing')
  }

  let evaluation: ScaffoldEvaluation
  try {
    evaluation = (await evaluateProject(projectId, { settle: true })).evaluation
  } catch (err) {
    if (err instanceof MigrationPendingError) return skip('migration_pending')
    console.error(`${tag} deployment lookup failed for ${projectId}:`, err)
    return skip('lookup_failed')
  }
  if (evaluation.state === 'building') {
    return skip('already_building', { deploymentId: evaluation.buildingRow?.vercel_deployment_id ?? undefined })
  }
  if (evaluation.state === 'up_to_date') {
    await syncProjectState(project, evaluation)
    return skip('up_to_date')
  }
  if (evaluation.state === 'no_live_version') return skip('no_live_version')
  const notUpdatable = outdatedSkipReason(evaluation, project, { ignoreAttemptCap: opts.ignoreAttemptCap })
  if (notUpdatable) return skip(notUpdatable)
  const liveCodeVersionId = evaluation.liveRow?.code_version_id as string

  // Claim the per-project trigger (compare-and-set on the attempt counter + a short time
  // lock): concurrent cron / admin / owner triggers can't start two builds.
  const attempts = project.scaffold_update_attempts ?? 0
  const nowIso = new Date().toISOString()
  const lockBefore = new Date(Date.now() - TRIGGER_LOCK_MS).toISOString()
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('projects')
    .update({ scaffold_update_attempts: attempts + 1, scaffold_update_at: nowIso })
    .eq('id', projectId)
    .eq('scaffold_update_attempts', attempts)
    .or(`scaffold_update_at.is.null,scaffold_update_at.lt.${lockBefore}`)
    .select('id')
  if (claimErr) {
    console.error(`${tag} trigger claim failed for ${projectId}:`, claimErr.message)
    return skip('lookup_failed')
  }
  if (!claimed || claimed.length === 0) return skip('in_progress')

  const fail = async (message: string, extra: Partial<RolloutResult> = {}): Promise<RolloutResult> => {
    await supabaseAdmin
      .from('projects')
      .update({ scaffold_update_error: message.slice(0, MAX_ERROR_CHARS) })
      .eq('id', projectId)
    return { projectId, status: 'failed', reason: 'error', error: message, ...extra }
  }
  const base: Partial<RolloutResult> = {
    codeVersionId: liveCodeVersionId,
    fromScaffoldVersion: evaluation.liveScaffoldVersion,
    toScaffoldVersion: SCAFFOLD_VERSION,
  }

  try {
    const { data: version, error: vErr } = await supabaseAdmin
      .from('code_versions')
      .select('id, files, version_no')
      .eq('id', liveCodeVersionId)
      .eq('project_id', projectId) // never another tenant's files
      .maybeSingle()
    if (vErr) return await fail(`Live code version lookup failed: ${vErr.message}`, base)
    if (!version) return await fail('The live code version no longer exists.', base)

    const codeFiles = (version.files ?? {}) as CodeVersionFiles
    // buildStoreFiles re-applies the AI file filter; list what it drops so admins / the
    // owner can see it (a dropped file the store imports fails the build — the previous
    // production deployment then stays live).
    const droppedFiles = filterAiStoreFiles(codeFiles).dropped.map((d) => ({
      path: d.path.slice(0, 200),
      reason: d.reason,
    }))
    const withDropped = { ...base, ...(droppedFiles.length > 0 ? { droppedFiles } : {}) }

    let files
    try {
      files = buildStoreFiles(codeFiles)
    } catch (err) {
      return await fail(`Building store files failed: ${(err as Error)?.message ?? err}`, withDropped)
    }

    // Identity only from the project uuid / its claimed slug — never from AI config.
    const vercelProjectId = await ensureProjectVercel(projectId)
    const slug = await getOrClaimStoreSlug(projectId, project.name ?? '')

    // The store needs its key + platform URL in env BEFORE the build (the scaffold's
    // locked checkout proxy reads them at build/runtime). Fatal here: deploying without
    // them could break checkout, and skipping leaves the current store untouched.
    const quanteApiKey = await ensureStoreApiKey(projectId, project.user_id)
    await setStoreConnectionEnv(vercelProjectId, projectId, appUrl, quanteApiKey)

    const result = await createPreviewDeployment(
      vercelProjectId,
      files.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
      slug,
    )
    const url = result.url.startsWith('https://') ? result.url : `https://${result.url}`
    const storeDomain = `${slug}.${HOSTING_ROOT_DOMAIN}`
    // Record the subdomain only when it was really attached to this project (same rule
    // as autoDeployCodeVersion) so the hosting cron sees what is live.
    const domain = url === `https://${storeDomain}` ? storeDomain : null

    const { error: insertErr } = await insertDeploymentRow({
      project_id: projectId,
      user_id: project.user_id,
      vercel_project_id: vercelProjectId,
      vercel_deployment_id: result.deploymentId,
      status: 'building',
      url,
      domain,
      version: (version as { version_no?: number | null }).version_no ?? null,
      code_version_id: liveCodeVersionId,
      target: 'production',
      scaffold_version: SCAFFOLD_VERSION,
      rollout_trigger: opts.trigger,
    })
    if (insertErr) {
      // The build is running but invisible to the row-based throttles and to 'building'
      // detection. Block new triggers of this store for a while (the claim needs
      // scaffold_update_at older than TRIGGER_LOCK_MS) and record why.
      console.error(`${tag} deployments insert failed for ${projectId}:`, insertErr.message)
      const message = 'The update build was started but could not be recorded; the store will be re-checked later.'
      await supabaseAdmin
        .from('projects')
        .update({
          scaffold_update_error: `${message} (${insertErr.message})`.slice(0, MAX_ERROR_CHARS),
          scaffold_update_at: new Date(Date.now() + UNRECORDED_BUILD_LOCK_MS).toISOString(),
        })
        .eq('id', projectId)
      return { projectId, status: 'failed', reason: 'error', error: message, deploymentId: result.deploymentId, url, ...withDropped }
    }

    await supabaseAdmin.from('projects').update({ scaffold_update_error: null }).eq('id', projectId)
    console.log(`${tag} scaffold v${SCAFFOLD_VERSION} build started`, {
      projectId, deploymentId: result.deploymentId, codeVersionId: liveCodeVersionId, dropped: droppedFiles.length,
    })
    return { projectId, status: 'started', deploymentId: result.deploymentId, url, ...withDropped }
  } catch (err) {
    console.error(`${tag} update failed for ${projectId}:`, err)
    return await fail(`Deployment failed: ${(err as Error)?.message ?? String(err)}`, base)
  }
}

// ─── Reconcile ────────────────────────────────────────────────────────────────

/**
 * Brings rollout bookkeeping up to date for production builds at the current scaffold
 * version created within RECONCILE_WINDOW_MS (> 1 day: the cron runs daily):
 *   1. rows the DB still shows as building/queued (nobody polled them) are settled with
 *      Vercel: READY → project marked up to date (scaffold_version, attempts reset,
 *      error cleared); ERROR/CANCELED of a rollout build → the build log excerpt lands
 *      in projects.scaffold_update_error (the previous production deployment stays live
 *      on Vercel);
 *   2. rows someone else already settled (the Studio's GET /api/deploy poll, the log
 *      stream) — those paths never touch `projects`: READY → project marked up to date;
 *      a failed rollout build → its error recorded, unless a newer attempt started or
 *      the store got current since.
 */
export async function reconcileRolloutDeployments(opts: { deadlineMs?: number } = {}): Promise<{
  checked: number; ready: number; failed: number; stillBuilding: number; migrationPending?: boolean
}> {
  const out = { checked: 0, ready: 0, failed: 0, stillBuilding: 0 }
  const since = new Date(Date.now() - RECONCILE_WINDOW_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('deployments')
    .select(`project_id, ${DEPLOYMENT_COLUMNS}`)
    .eq('target', 'production')
    .eq('scaffold_version', SCAFFOLD_VERSION)
    .in('status', ['building', 'queued'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) {
    if (isUnknownColumnError(error)) return { ...out, migrationPending: true }
    throw new Error(`[scaffold-rollout] reconcile lookup failed: ${error.message}`)
  }
  for (const row of (data ?? []) as unknown as Array<RolloutDeploymentRow & { project_id: string }>) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break
    if (!row.vercel_deployment_id) continue
    out.checked++
    let state: string
    try {
      state = (await getDeploymentStatus(row.vercel_deployment_id)).state
    } catch (err) {
      if (vercelStatusCode(err) !== 404) {
        console.warn('[scaffold-rollout] reconcile status lookup failed:', (err as Error)?.message ?? err)
        continue
      }
      state = 'error'
    }
    if (state === 'ready') {
      await applySettledState(row.project_id, row, 'ready', null)
      out.ready++
    } else if (state === 'error' || state === 'canceled') {
      const msg = state === 'error' ? await getBuildError(row.vercel_deployment_id) : 'Deployment was canceled.'
      await applySettledState(row.project_id, row, state, msg)
      out.failed++
    } else {
      out.stillBuilding++
    }
  }

  if (!opts.deadlineMs || Date.now() <= opts.deadlineMs) {
    await reconcileSettledElsewhere(since)
  }
  return out
}

/** Step 2 of reconcileRolloutDeployments(): DB only. */
async function reconcileSettledElsewhere(since: string): Promise<void> {
  // READY production builds at the current version → those stores are up to date.
  const { data: readyRows, error: readyErr } = await supabaseAdmin
    .from('deployments')
    .select('project_id')
    .eq('target', 'production')
    .eq('scaffold_version', SCAFFOLD_VERSION)
    .eq('status', 'ready')
    .gte('created_at', since)
    .limit(1000)
  if (readyErr) {
    console.error('[scaffold-rollout] reconcile (ready rows) lookup failed:', readyErr.message)
  } else {
    const ids = [...new Set(((readyRows ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))]
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabaseAdmin
        .from('projects')
        .update({ scaffold_version: SCAFFOLD_VERSION, scaffold_update_attempts: 0, scaffold_update_error: null })
        .in('id', ids.slice(i, i + 100))
        .or(STALE_PROJECT_VERSION)
      if (error) console.error('[scaffold-rollout] reconcile (ready) project update failed:', error.message)
    }
  }

  // Failed ROLLOUT builds → record the error on stores that are still outdated, have no
  // error recorded, and started no newer attempt since that build.
  const { data: failedRows, error: failedErr } = await supabaseAdmin
    .from('deployments')
    .select('project_id, created_at, status, error_message')
    .eq('target', 'production')
    .eq('scaffold_version', SCAFFOLD_VERSION)
    .not('rollout_trigger', 'is', null)
    .in('status', ['error', 'canceled'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)
  if (failedErr) {
    console.error('[scaffold-rollout] reconcile (failed rows) lookup failed:', failedErr.message)
    return
  }
  const newestPerProject = new Map<string, { created_at: string; status: string; error_message: string | null }>()
  for (const r of (failedRows ?? []) as Array<{ project_id: string; created_at: string; status: string; error_message: string | null }>) {
    if (!newestPerProject.has(r.project_id)) newestPerProject.set(r.project_id, r)
  }
  for (const [projectId, r] of newestPerProject) {
    const message = (r.error_message || (r.status === 'canceled' ? 'Deployment was canceled.' : 'Build failed.'))
      .slice(0, MAX_ERROR_CHARS)
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ scaffold_update_error: message })
      .eq('id', projectId)
      .is('scaffold_update_error', null)
      .lte('scaffold_update_at', r.created_at)
      .or(STALE_PROJECT_VERSION)
    if (error) console.error('[scaffold-rollout] reconcile (failed) project update failed:', error.message)
  }
}

// ─── Batch helper (admin / cron) ──────────────────────────────────────────────

/** Updates the given stores with at most `concurrency` in flight; stops starting new ones past the deadline. */
export async function updateStores(
  projectIds: string[],
  opts: { trigger: RolloutTrigger; concurrency?: number; deadlineMs?: number; ignoreAttemptCap?: boolean },
): Promise<RolloutResult[]> {
  const results: RolloutResult[] = []
  const queue = [...projectIds]
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 1, 5)) }, async () => {
    for (;;) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) return
      const id = queue.shift()
      if (!id) return
      results.push(await updateStoreScaffold(id, { trigger: opts.trigger, ignoreAttemptCap: opts.ignoreAttemptCap }))
    }
  })
  await Promise.all(workers)
  return results
}
