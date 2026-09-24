// Pure decision rules for the scaffold rollout (lib/hosting/scaffold-rollout.ts) and the
// shared "is this deployments row a production build?" classifier (also used by the
// store checkout pricing, app/api/store/_lib/pricing.ts — one definition of "live").
// No imports and no I/O on purpose: __tests__/scaffold-rollout.test.mjs imports this
// file directly through Node's TypeScript type stripping, so keep it to erasable TS
// syntax (no enums / namespaces / parameter properties) and no '@/…' imports.

/** Subset of a `deployments` row the rules look at. */
export interface RolloutDeploymentRow {
  id: string
  vercel_project_id?: string | null
  vercel_deployment_id?: string | null
  status: string | null
  created_at: string | null
  code_version_id: string | null
  domain: string | null
  url: string | null
  /** 'production' | 'preview' | 'maintenance'; null/undefined on pre-migration rows. */
  target?: string | null
  /** null/undefined = built before scaffold versioning = version 1. */
  scaffold_version?: number | null
  /** 'admin' | 'cron' | 'owner' on scaffold rollout builds; null on every other build. */
  rollout_trigger?: string | null
}

/** Subset of a `projects` row the rules look at. */
export interface RolloutProjectRow {
  scaffold_version?: number | null
  scaffold_update_attempts?: number | null
  scaffold_update_error?: string | null
}

/** A production build that is still building this long after it was created is stale. */
export const BUILDING_FRESH_MS = 15 * 60 * 1000
/** The cron / admin batch stop retrying a store after this many attempts without success. */
export const MAX_SCAFFOLD_UPDATE_ATTEMPTS = 3

const FAILED_STATUSES = new Set(['error', 'canceled'])
const IN_PROGRESS_STATUSES = new Set(['building', 'queued'])

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isVercelAppHost(host: string): boolean {
  return host === 'vercel.app' || host.endsWith('.vercel.app')
}

export type DeploymentKind = 'production' | 'preview' | 'maintenance' | 'ambiguous'

/**
 * What a deployments row is.
 *   - `target` set (rows written since migration-scaffold-version.sql) → exactly that
 *     (an unknown value counts as a preview).
 *   - legacy rows without `target`:
 *       domain recorded (Push to Live, production auto-deploys, restore) → production;
 *       URL on a public store host (not *.vercel.app — the only non-vercel.app URLs the
 *       server writes are the store subdomain / public domain of a production build)
 *         → production;
 *       domain null + raw *.vercel.app URL (or no URL) → 'ambiguous': that is a true
 *         preview OR a production build whose subdomain attach failed (iterate / fix /
 *         redeploy auto-deploys, or GET /api/deploy cleared `domain`). Only Vercel knows
 *         (the deployment's `target`); callers that can't ask must treat it as NOT
 *         production (pricing), callers that pick a live version to REDEPLOY must resolve
 *         it first (scaffold rollout — see ambiguousRowsToResolve).
 */
export function classifyDeploymentRow(row: RolloutDeploymentRow): DeploymentKind {
  if (row.target === 'production') return 'production'
  if (row.target === 'maintenance') return 'maintenance'
  if (row.target) return 'preview'
  if (row.domain) return 'production'
  const host = hostOf(row.url)
  if (!host || isVercelAppHost(host)) return 'ambiguous'
  return 'production'
}

/** Is this row (confidently) a production build — what the store's public domains serve once READY? */
export function isProductionRow(row: RolloutDeploymentRow): boolean {
  return classifyDeploymentRow(row) === 'production'
}

/** The scaffold version a row was built with (null / missing / invalid = 1). */
export function rowScaffoldVersion(row: RolloutDeploymentRow): number {
  const v = row.scaffold_version
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
}

function createdMs(row: RolloutDeploymentRow): number {
  const t = row.created_at ? Date.parse(row.created_at) : NaN
  return Number.isFinite(t) ? t : 0
}

function newestFirst(rows: RolloutDeploymentRow[]): RolloutDeploymentRow[] {
  return [...rows].sort((a, b) => createdMs(b) - createdMs(a))
}

/** Production rows only, newest first. */
export function productionRowsNewestFirst(rows: RolloutDeploymentRow[]): RolloutDeploymentRow[] {
  return newestFirst(rows.filter(isProductionRow))
}

/**
 * The deployment that is LIVE in production: the newest production row with status
 * 'ready'. Rows must have their statuses settled and ambiguous legacy rows resolved (see
 * scaffold-rollout.ts). Never falls back to anything else — no live row = null.
 */
export function pickLiveDeployment(rows: RolloutDeploymentRow[]): RolloutDeploymentRow | null {
  return productionRowsNewestFirst(rows).find((r) => r.status === 'ready') ?? null
}

/**
 * The code version to rebuild with the new scaffold: the live deployment's
 * code_version_id. null when nothing is live or the live row carries no version id —
 * the caller must then skip the store ('no_live_version'); it must never fall back to
 * the latest (possibly unpublished) draft.
 */
export function pickLiveCodeVersionId(rows: RolloutDeploymentRow[]): string | null {
  return pickLiveDeployment(rows)?.code_version_id ?? null
}

/**
 * Legacy 'ambiguous' rows that could change the live-version answer: not failed, have a
 * Vercel deployment id, and are newer than the newest READY confident-production row
 * (older ones can't be the live build — settling only ever moves the live row newer).
 * Newest first, at most `max`. The rollout asks Vercel for their real target and must
 * not redeploy anything while one of them is unresolved.
 */
export function ambiguousRowsToResolve(rows: RolloutDeploymentRow[], max = 5): RolloutDeploymentRow[] {
  const boundary = pickLiveDeployment(rows)
  const boundaryMs = boundary ? createdMs(boundary) : -Infinity
  const out: RolloutDeploymentRow[] = []
  for (const r of newestFirst(rows)) {
    if (createdMs(r) <= boundaryMs) break
    if (classifyDeploymentRow(r) !== 'ambiguous') continue
    if (FAILED_STATUSES.has(r.status ?? '') || !r.vercel_deployment_id) continue
    out.push(r)
    if (out.length >= max) break
  }
  return out
}

export type ScaffoldState = 'up_to_date' | 'outdated' | 'building' | 'no_live_version'

export interface ScaffoldEvaluation {
  state: ScaffoldState
  outdated: boolean
  /** Scaffold version of the live production build (null when nothing is live). */
  liveScaffoldVersion: number | null
  liveRow: RolloutDeploymentRow | null
  /** A fresh production build at the current version, when state = 'building'. */
  buildingRow: RolloutDeploymentRow | null
}

/**
 * Decides whether a store needs the current scaffold.
 *   - error/canceled production rows are ignored (Vercel keeps serving the previous
 *     production deployment when a build fails);
 *   - a production build at >= currentVersion that is still building/queued and was
 *     created < BUILDING_FRESH_MS ago → 'building' (not outdated, don't start another);
 *   - otherwise the newest READY production row decides: its scaffold_version
 *     (null = 1) < currentVersion → 'outdated', else 'up_to_date';
 *   - no ready production row → 'no_live_version' (not outdated, nothing to update).
 */
export function evaluateScaffoldState(
  rows: RolloutDeploymentRow[],
  opts: { currentVersion: number; now?: number; buildingFreshMs?: number },
): ScaffoldEvaluation {
  const now = opts.now ?? Date.now()
  const freshMs = opts.buildingFreshMs ?? BUILDING_FRESH_MS
  const prod = productionRowsNewestFirst(rows)

  let buildingRow: RolloutDeploymentRow | null = null
  let liveRow: RolloutDeploymentRow | null = null
  for (const r of prod) {
    const status = r.status ?? ''
    if (FAILED_STATUSES.has(status)) continue
    if (status === 'ready') {
      liveRow = r
      break
    }
    if (
      !buildingRow &&
      IN_PROGRESS_STATUSES.has(status) &&
      rowScaffoldVersion(r) >= opts.currentVersion &&
      now - createdMs(r) < freshMs
    ) {
      buildingRow = r
    }
  }

  const liveScaffoldVersion = liveRow ? rowScaffoldVersion(liveRow) : null
  if (buildingRow) {
    return { state: 'building', outdated: false, liveScaffoldVersion, liveRow, buildingRow }
  }
  if (!liveRow) {
    return { state: 'no_live_version', outdated: false, liveScaffoldVersion: null, liveRow: null, buildingRow: null }
  }
  const outdated = (liveScaffoldVersion as number) < opts.currentVersion
  return { state: outdated ? 'outdated' : 'up_to_date', outdated, liveScaffoldVersion, liveRow, buildingRow: null }
}

/** Convenience wrapper: is this store's live build older than currentVersion? */
export function isStoreOutdated(
  rows: RolloutDeploymentRow[],
  opts: { currentVersion: number; now?: number },
): boolean {
  return evaluateScaffoldState(rows, opts).outdated
}

/** The cron / admin batch skip a store once it was attempted this many times without success. */
export function isAttemptCapped(project: RolloutProjectRow, max = MAX_SCAFFOLD_UPDATE_ATTEMPTS): boolean {
  const n = project.scaffold_update_attempts
  return typeof n === 'number' && Number.isFinite(n) && n >= max
}

/**
 * Why an OUTDATED store will not be updated by a run (null = update it). Checked while
 * finding stores so a store that can never be updated doesn't take a batch slot:
 *   - the live build carries no code_version_id (legacy manifest-era rows) → nothing
 *     to rebuild ('no_live_version');
 *   - attempt cap reached ('attempts_exhausted'), unless an admin / owner retries.
 */
export function outdatedSkipReason(
  evaluation: ScaffoldEvaluation,
  project: RolloutProjectRow,
  opts: { ignoreAttemptCap?: boolean } = {},
): 'no_live_version' | 'attempts_exhausted' | null {
  if (!evaluation.liveRow?.code_version_id) return 'no_live_version'
  if (!opts.ignoreAttemptCap && isAttemptCapped(project)) return 'attempts_exhausted'
  return null
}

/**
 * Bookkeeping to write on the project when its live build is up to date but the row
 * still carries rollout state (attempt count, stale scaffold_version, old error) —
 * e.g. the rollout build was settled by the Studio's GET /api/deploy poll, which never
 * touches `projects`. Without this, attempts would pile up across successful updates
 * and eventually cap the store. null = nothing to write.
 */
export function projectSyncPatch(
  project: RolloutProjectRow,
  evaluation: ScaffoldEvaluation,
): { scaffold_version: number; scaffold_update_attempts: 0; scaffold_update_error: null } | null {
  if (evaluation.state !== 'up_to_date' || evaluation.liveScaffoldVersion === null) return null
  const stale =
    (project.scaffold_update_attempts ?? 0) !== 0 ||
    project.scaffold_version !== evaluation.liveScaffoldVersion ||
    !!project.scaffold_update_error
  return stale
    ? { scaffold_version: evaluation.liveScaffoldVersion, scaffold_update_attempts: 0, scaffold_update_error: null }
    : null
}

/**
 * Production rows whose DB status may be stale and could change the live-version
 * answer: in-progress rows newer than the newest READY production row (DB rows only
 * settle when someone polls /api/deploy or streams its logs — e.g. restore and
 * rollout rows often stay 'building' after Vercel made them live). Newest first.
 */
export function rowsNeedingSettle(rows: RolloutDeploymentRow[], max = 5): RolloutDeploymentRow[] {
  const out: RolloutDeploymentRow[] = []
  for (const r of productionRowsNewestFirst(rows)) {
    if (r.status === 'ready') break
    if (IN_PROGRESS_STATUSES.has(r.status ?? '') && r.vercel_deployment_id) out.push(r)
    if (out.length >= max) break
  }
  return out
}
