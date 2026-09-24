// GET /api/cron/hosting — daily Vercel cron (see vercel.json).
// 1. Sends expiry reminder emails 7 days and 1 day before trial/subscription end.
// 2. Suspends expired stores: deploys a white-label maintenance page to the
//    store's Vercel project and, once that build is READY, marks
//    projects.hosting_suspended_at.
// 3. Re-suspends stores that got a production deploy after being suspended
//    without an active plan (defense in depth behind lib/hosting/gate.ts).
// 4. Starts the trial clock for legacy stores that went live on a production
//    deploy without ever starting a trial (the old free "Rebuild preview" path).
// 5. Refreshes custom-domain proof flags (projects.custom_domain_verified,
//    user_domains.dns_verified) from the domain's live DNS, so a claim only keeps
//    blocking other users while its DNS really points at Vercel (audit #38 follow-up,
//    see app/api/domains/_lib/hostname.ts).
// Store data is NEVER deleted — resubscribing restores the store automatically
// (see the hosting branch of /api/stripe/webhook).
//
// SECURITY (audit #39/#40/#41): fails closed without CRON_SECRET; walks EVERY
// eligible project with keyset pagination and a cursor persisted in cron_state
// (supabase/migration-security-deploy-hosting-cron.sql), so a run that hits its time
// budget resumes where it stopped instead of restarting at the first id; and a store
// is only marked suspended after the maintenance build is confirmed READY — a failed
// maintenance build leaves it unsuspended so the next run retries.
// Any lookup error aborts the run (500) rather than defaulting to "no
// subscription", so a paying customer is never suspended because a query failed.

import { NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createPreviewDeployment, getDeploymentStatus, getDomainDnsConfigured, HOSTING_ROOT_DOMAIN } from '@/lib/hosting/vercel'
import { type DomainRow, isLiveStatus, isQuanteRegistered } from '@/app/api/domains/_lib/release'
import { maintenanceSiteFiles } from '@/lib/hosting/maintenance-site'
import { getHostingGate, hasUsedHostingTrial } from '@/lib/hosting/gate'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { isUuid } from '@/lib/auth/project'
import { hostingReminderEmail, hostingSuspendedEmail, sendEmail } from '@/lib/email-templates'

export const maxDuration = 300

const BILLING_FROM = 'Quante <billing@quantecode.com>'

// ≤100 ids per `.in()` keeps PostgREST URLs short.
const PAGE_SIZE = 100
// Phase deadlines (ms since start), leaving headroom under maxDuration. Each walk
// persists its cursor, so the next run picks up exactly where this one stopped.
const MAIN_PASS_DEADLINE_MS = 130_000
const LEGACY_PASS_DEADLINE_MS = 170_000
const DOMAIN_PASS_DEADLINE_MS = 200_000
const SETTLE_DEADLINE_MS = 280_000
const POLL_INTERVAL_MS = 5_000
const TRIAL_MS = 30 * 24 * 60 * 60 * 1000
// Grace window for legacy live stores whose owner already used their one free trial.
const LEGACY_GRACE_MS = 8 * 24 * 60 * 60 * 1000

const CURSOR_MAIN = 'hosting_cron_main_cursor'
const CURSOR_LEGACY = 'hosting_cron_legacy_cursor'
const CURSOR_PROJECT_DOMAINS = 'hosting_cron_project_domain_cursor'
const CURSOR_USER_DOMAINS = 'hosting_cron_user_domain_cursor'

// Deployment rows that may be live on production. A deploy triggered through an API
// and never polled stays 'building'/'queued' in our table even after Vercel made it
// live, so those count too (audit #7) — only a confirmed error/cancel is excluded.
const MAYBE_LIVE_STATUSES = ['queued', 'building', 'ready']

interface ProjectRow {
  id: string
  name: string
  user_id: string
  vercel_project_id: string | null
  store_slug: string | null
  hosting_trial_ends_at: string
  hosting_suspended_at: string | null
}

interface SubRow {
  project_id: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: boolean | null
}

interface PendingMaintenance {
  project: ProjectRow
  deploymentId: string
  kind: 'suspend' | 'resuspend'
  refDate: string | null
  storeUrl: string | null
  /** null when NEXT_PUBLIC_APP_URL is unusable — emails are then skipped, never sent with a guessed host. */
  projectUrl: string | null
}

interface Stats {
  scanned: number
  reminders: number
  suspended: number
  resuspended: number
  trialsStarted: number
  domainProofsUpdated: number
  maintenanceFailed: number
  maintenancePending: number
  partial: boolean
}

class CronLookupError extends Error {}

// Dashboard links in billing emails. Fails closed: no hard-coded fallback host — a
// missing/non-https NEXT_PUBLIC_APP_URL means the emails are skipped (and retried on a
// later run, since the reminder is not claimed), while suspension still proceeds.
function platformAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

// Agency owners are never suspended (lib/hosting/gate.ts). The gate treats an agency
// lookup failure as "not agency", which is right for deploys (fail closed) but wrong
// for the cron, where it would take a paying Agency store offline. So the cron checks
// the owner's plan itself and aborts the run on a lookup error.
async function ownerIsActiveAgency(userId: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(userId)
  if (cached !== undefined) return cached
  let { data, error } = await supabaseAdmin
    .from('users')
    .select('tier, subscription_status, billing_hold')
    .eq('id', userId)
    .maybeSingle()
  // billing_hold column not migrated yet (42703 / PGRST204) → no hold.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    ({ data, error } = await supabaseAdmin
      .from('users')
      .select('tier, subscription_status')
      .eq('id', userId)
      .maybeSingle())
  }
  if (error) throw new CronLookupError(`users for ${userId}: ${error.message}`)
  const row = data as { tier?: string | null; subscription_status?: string | null; billing_hold?: boolean | null } | null
  // A charged-back Agency invoice (billing_hold) loses the "never suspended" exemption,
  // matching isAgencyUser() in lib/tier.ts.
  const agency = row?.tier === 'agency' && row?.subscription_status === 'active' && row?.billing_hold !== true
  cache.set(userId, agency)
  return agency
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const pastDeadline = (ms: number) => () => Date.now() - startedAt > ms

  const stats: Stats = {
    scanned: 0, reminders: 0, suspended: 0, resuspended: 0, trialsStarted: 0, domainProofsUpdated: 0,
    maintenanceFailed: 0, maintenancePending: 0, partial: false,
  }
  const pending: PendingMaintenance[] = []

  try {
    // ── Main pass: every project that has gone live (trial stamped) ───────────
    const mainOutOfTime = pastDeadline(MAIN_PASS_DEADLINE_MS)
    const main = await walkProjects<ProjectRow>(
      CURSOR_MAIN,
      async (after, upTo) => {
        let q = supabaseAdmin
          .from('projects')
          .select('id, name, user_id, vercel_project_id, store_slug, hosting_trial_ends_at, hosting_suspended_at')
          .not('hosting_trial_ends_at', 'is', null)
          .neq('status', 'deleted')
          .order('id', { ascending: true })
          .limit(PAGE_SIZE)
        if (after) q = q.gt('id', after)
        if (upTo) q = q.lte('id', upTo)
        const { data, error } = await q
        if (error) throw new CronLookupError(`projects page: ${error.message}`)
        return (data ?? []) as ProjectRow[]
      },
      (rows) => processPage(rows, stats, pending, mainOutOfTime),
      mainOutOfTime,
    )
    stats.scanned += main.scanned
    if (!main.complete) stats.partial = true

    // ── Legacy pass: live on production, but no trial ever started ────────────
    const legacyOutOfTime = pastDeadline(LEGACY_PASS_DEADLINE_MS)
    const legacy = await walkProjects<{ id: string }>(
      CURSOR_LEGACY,
      async (after, upTo) => {
        let q = supabaseAdmin
          .from('projects')
          .select('id')
          .is('hosting_trial_ends_at', null)
          .not('vercel_project_id', 'is', null)
          .neq('status', 'deleted')
          .order('id', { ascending: true })
          .limit(PAGE_SIZE)
        if (after) q = q.gt('id', after)
        if (upTo) q = q.lte('id', upTo)
        const { data, error } = await q
        if (error) throw new CronLookupError(`legacy projects page: ${error.message}`)
        return (data ?? []) as Array<{ id: string }>
      },
      (rows) => startMissingTrials(rows, stats, legacyOutOfTime),
      legacyOutOfTime,
    )
    if (!legacy.complete) stats.partial = true

    // ── Domain proof refresh (best-effort; never affects suspension) ──────────
    const domainsOutOfTime = pastDeadline(DOMAIN_PASS_DEADLINE_MS)
    try {
      const projDomains = await walkProjects<ProjectDomainRow>(
        CURSOR_PROJECT_DOMAINS,
        async (after, upTo) => {
          let q = supabaseAdmin
            .from('projects')
            .select('id, custom_domain, custom_domain_verified')
            .not('custom_domain', 'is', null)
            .neq('status', 'deleted')
            .order('id', { ascending: true })
            .limit(PAGE_SIZE)
          if (after) q = q.gt('id', after)
          if (upTo) q = q.lte('id', upTo)
          const { data, error } = await q
          if (error) throw new CronLookupError(`project domains page: ${error.message}`)
          return (data ?? []) as ProjectDomainRow[]
        },
        (rows) => refreshProjectDomainProofs(rows, stats, domainsOutOfTime),
        domainsOutOfTime,
      )
      const userDomains = await walkProjects<DomainRow>(
        CURSOR_USER_DOMAINS,
        async (after, upTo) => {
          let q = supabaseAdmin
            .from('user_domains')
            .select('*')
            .in('status', ['pending', 'active'])
            .order('id', { ascending: true })
            .limit(PAGE_SIZE)
          if (after) q = q.gt('id', after)
          if (upTo) q = q.lte('id', upTo)
          const { data, error } = await q
          if (error) throw new CronLookupError(`user domains page: ${error.message}`)
          return (data ?? []) as DomainRow[]
        },
        (rows) => refreshUserDomainProofs(rows, stats, domainsOutOfTime),
        domainsOutOfTime,
      )
      if (!projDomains.complete || !userDomains.complete) stats.partial = true
    } catch (err) {
      console.error('[cron/hosting] domain proof refresh failed (suspension pass unaffected):', err)
      stats.partial = true
    }
  } catch (err) {
    console.error('[cron/hosting] aborted:', err)
    // Maintenance builds already started still get confirmed before we exit.
    await settleMaintenance(pending, stats, pastDeadline(SETTLE_DEADLINE_MS))
    return NextResponse.json({ ok: false, error: 'lookup_failed', ...stats }, { status: 500 })
  }

  // ── Confirm maintenance builds, then mark suspended ─────────────────────────
  await settleMaintenance(pending, stats, pastDeadline(SETTLE_DEADLINE_MS))

  return NextResponse.json({ ok: true, ...stats })
}

// Keyset walk over projects ordered by id, starting at the persisted cursor and
// wrapping around to the beginning, so every project is visited even when a single
// run can't cover them all. `handlePage` returns how many rows it fully processed
// (fewer than the page = out of time); the cursor is saved at the last processed id,
// or cleared once the whole table has been covered.
async function walkProjects<T extends { id: string }>(
  cursorKey: string,
  fetchPage: (after: string | null, upTo: string | null) => Promise<T[]>,
  handlePage: (rows: T[]) => Promise<number>,
  outOfTime: () => boolean,
): Promise<{ scanned: number; complete: boolean }> {
  const start = await readCursor(cursorKey)
  const legs: Array<{ after: string | null; upTo: string | null }> = start
    ? [{ after: start, upTo: null }, { after: null, upTo: start }]
    : [{ after: null, upTo: null }]

  let scanned = 0
  for (const leg of legs) {
    let after = leg.after
    while (true) {
      if (outOfTime()) {
        await writeCursor(cursorKey, after)
        return { scanned, complete: false }
      }
      const rows = await fetchPage(after, leg.upTo)
      if (rows.length === 0) break
      const processed = await handlePage(rows)
      scanned += processed
      if (processed > 0) after = rows[processed - 1].id
      if (processed < rows.length) {
        await writeCursor(cursorKey, after)
        return { scanned, complete: false }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }
  await writeCursor(cursorKey, null)
  return { scanned, complete: true }
}

// Cursor storage is best-effort: without the cron_state table (migration not run yet)
// every run simply starts from the first id, as before.
async function readCursor(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('cron_state').select('value').eq('key', key).maybeSingle()
  if (error) {
    console.warn(`[cron/hosting] could not read cursor ${key} (run migration-security-deploy-hosting-cron.sql?):`, error.message)
    return null
  }
  const value = (data as { value?: unknown } | null)?.value
  return typeof value === 'string' && isUuid(value) ? value : null
}

async function writeCursor(key: string, value: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('cron_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.warn(`[cron/hosting] could not save cursor ${key}:`, error.message)
}

async function processPage(
  projects: ProjectRow[],
  stats: Stats,
  pending: PendingMaintenance[],
  outOfTime: () => boolean,
): Promise<number> {
  const now = Date.now()
  const appUrl = platformAppUrl()
  if (!appUrl) console.error('[cron/hosting] NEXT_PUBLIC_APP_URL is missing or not https — billing emails are skipped this run')
  const agencyCache = new Map<string, boolean>()
  const projectIds = projects.map((p) => p.id)

  const { data: subs, error: subErr } = await supabaseAdmin
    .from('hosting_subscriptions')
    .select('project_id, status, current_period_end, cancel_at_period_end')
    .in('project_id', projectIds)
    .in('status', ['active', 'trialing'])
  if (subErr) throw new CronLookupError(`hosting_subscriptions: ${subErr.message}`)

  const subByProject = new Map<string, SubRow>(
    ((subs ?? []) as SubRow[]).map((s) => [s.project_id, s]),
  )

  for (let i = 0; i < projects.length; i++) {
    if (outOfTime()) return i
    const project = projects[i]

    const sub = subByProject.get(project.id)

    // Active auto-renewing subscription → nothing to do
    if (sub && !sub.cancel_at_period_end) continue

    const projectUrl = appUrl ? `${appUrl}/project/${project.id}` : null


    // ── Already suspended: re-suspend if a production deploy slipped through ──
    if (project.hosting_suspended_at) {
      if (sub || !project.vercel_project_id) continue
      const newerProdDeploy = await hasProductionDeployAfter(project.id, project.hosting_suspended_at)
      if (!newerProdDeploy) continue
      if (await ownerIsActiveAgency(project.user_id, agencyCache)) continue
      const gate = await getHostingGate(project.id)
      if (gate.reason === 'lookup_failed') throw new CronLookupError(`gate for ${project.id}`)
      if (gate.canDeployProduction) continue
      const deploymentId = await deployMaintenance(project)
      if (deploymentId) {
        pending.push({ project, deploymentId, kind: 'resuspend', refDate: null, storeUrl: null, projectUrl })
      } else {
        stats.maintenanceFailed++
      }
      continue
    }

    const endsAtIso = sub ? sub.current_period_end : project.hosting_trial_ends_at
    if (!endsAtIso) continue

    const endsAt = new Date(endsAtIso).getTime()
    if (!Number.isFinite(endsAt)) continue
    const daysLeft = Math.ceil((endsAt - now) / 86400000)
    // Nothing to do until 7 days before expiry.
    if (daysLeft > 7) continue

    // Agency owners are never suspended, so they get no expiry reminders either.
    if (await ownerIsActiveAgency(project.user_id, agencyCache)) continue

    const refDate = endsAtIso.slice(0, 10)
    const isTrial = !sub
    const domain = await latestLiveDomain(project.id)
    const storeUrl = domain ? `https://${domain}` : null

    // ── Reminders (7d / 1d before expiry) ──────────────────────────────────
    if (daysLeft > 0) {
      const kind = daysLeft <= 1 ? 'reminder_1d' : 'reminder_7d'
      if (projectUrl && (await claimReminder(project.id, kind, refDate))) {
        const email = await getOwnerEmail(project.user_id)
        if (email) {
          const { subject, html } = hostingReminderEmail({
            storeName: project.name,
            storeUrl,
            endsAt: endsAtIso,
            daysLeft: daysLeft <= 1 ? 1 : 7,
            isTrial,
            projectUrl,
          })
          await sendEmail(email, subject, html, BILLING_FROM)
          stats.reminders++
        }
      }
      continue
    }

    // ── Suspension (expired, not yet suspended, has a Vercel project) ──────
    if (!project.vercel_project_id) continue

    // Same rules as every deploy path (subscription grace, Agency plan) so the cron
    // never suspends a store the gate would let the owner redeploy.
    const gate = await getHostingGate(project.id)
    if (gate.reason === 'lookup_failed') throw new CronLookupError(`gate for ${project.id}`)
    if (gate.canDeployProduction) continue

    const deploymentId = await deployMaintenance(project, domain)
    if (!deploymentId) { stats.maintenanceFailed++; continue } // retry on the next run
    pending.push({ project, deploymentId, kind: 'suspend', refDate, storeUrl, projectUrl })
  }
  return projects.length
}

// Production target → every domain on the Vercel project (subdomain + custom domain)
// serves the maintenance page once the build is READY. Returns the deployment id, or
// null when Vercel refused the deployment.
async function deployMaintenance(project: ProjectRow, knownDomain?: string | null): Promise<string | null> {
  const legacySlug = knownDomain && knownDomain.endsWith(`.${HOSTING_ROOT_DOMAIN}`)
    ? knownDomain.slice(0, -(HOSTING_ROOT_DOMAIN.length + 1))
    : undefined
  try {
    const { deploymentId } = await createPreviewDeployment(
      project.vercel_project_id as string,
      maintenanceSiteFiles(project.name),
      project.store_slug ?? legacySlug,
    )
    return deploymentId
  } catch (err) {
    console.error(`[cron/hosting] maintenance deploy failed for ${project.id}:`, err)
    return null
  }
}

// SECURITY (audit #41): Vercel accepting a deployment is not the store going offline —
// if the maintenance build ERRORs, production keeps serving the real store. Marking the
// project suspended at that point would take it out of every later pass (free hosting
// forever), so we only mark it once the build is READY. Builds still running at the
// deadline, or that failed, stay unsuspended and are retried on the next run.
async function settleMaintenance(
  pending: PendingMaintenance[],
  stats: Stats,
  outOfTime: () => boolean,
): Promise<void> {
  let open = [...pending]
  while (open.length > 0) {
    const stillBuilding: PendingMaintenance[] = []
    for (const p of open) {
      let state: string
      try {
        state = (await getDeploymentStatus(p.deploymentId)).state
      } catch (err) {
        console.warn(`[cron/hosting] maintenance status lookup failed for ${p.project.id}:`, err)
        stillBuilding.push(p)
        continue
      }

      if (state === 'ready') {
        if (!(await markSuspended(p.project.id))) continue
        if (p.kind === 'resuspend') {
          stats.resuspended++
          continue
        }
        stats.suspended++
        if (p.refDate && p.projectUrl && (await claimReminder(p.project.id, 'suspended', p.refDate))) {
          const email = await getOwnerEmail(p.project.user_id)
          if (email) {
            const { subject, html } = hostingSuspendedEmail({
              storeName: p.project.name,
              storeUrl: p.storeUrl,
              projectUrl: p.projectUrl,
            })
            await sendEmail(email, subject, html, BILLING_FROM)
          }
        }
      } else if (state === 'error' || state === 'canceled') {
        console.error(
          `[cron/hosting] maintenance build ${p.deploymentId} for ${p.project.id} ended ${state} — store NOT suspended; retrying next run`,
        )
        stats.maintenanceFailed++
      } else {
        stillBuilding.push(p)
      }
    }
    open = stillBuilding
    if (open.length === 0 || outOfTime()) break
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  for (const p of open) {
    console.warn(
      `[cron/hosting] maintenance build ${p.deploymentId} for ${p.project.id} not READY before the deadline — not marked suspended; next run retries`,
    )
  }
  stats.maintenancePending = open.length
  if (open.length > 0) stats.partial = true
}

async function markSuspended(projectId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('projects')
    .update({ hosting_suspended_at: new Date().toISOString() })
    .eq('id', projectId)
  if (error) {
    console.error(`[cron/hosting] failed to mark ${projectId} suspended:`, error)
    return false
  }
  return true
}

const subdomainUrlPattern = () => `*.${HOSTING_ROOT_DOMAIN}`

// Latest ready production deployment's public host (subdomain), if any.
async function latestLiveDomain(projectId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('deployments')
    .select('domain')
    .eq('project_id', projectId)
    .eq('status', 'ready')
    .not('domain', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new CronLookupError(`deployments for ${projectId}: ${error.message}`)
  return (data as { domain: string | null } | null)?.domain ?? null
}

// A production deploy is one recorded with a domain (Push to Live) or whose URL is
// the store subdomain (auto-deploys through createPreviewDeployment).
async function hasProductionDeployAfter(projectId: string, sinceIso: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('deployments')
    .select('id')
    .eq('project_id', projectId)
    .in('status', MAYBE_LIVE_STATUSES)
    .gt('created_at', sinceIso)
    .or(`domain.not.is.null,url.ilike.${subdomainUrlPattern()}`)
    .limit(1)
  if (error) throw new CronLookupError(`deployments for ${projectId}: ${error.message}`)
  return !!data && data.length > 0
}

// SECURITY (audit #16): stores that reached production before the trial was started
// server-side were invisible to this cron forever. Give them a trial starting now so
// they enter the normal reminder → suspension flow. One limit(1) lookup per project, so
// no project is skipped because a batched deployments query hit a row cap.
async function startMissingTrials(
  rows: Array<{ id: string }>,
  stats: Stats,
  outOfTime: () => boolean,
): Promise<number> {
  for (let i = 0; i < rows.length; i++) {
    if (outOfTime()) return i
    const id = rows[i].id

    const { data: live, error: depErr } = await supabaseAdmin
      .from('deployments')
      .select('id')
      .eq('project_id', id)
      .in('status', MAYBE_LIVE_STATUSES)
      .or(`domain.not.is.null,url.ilike.${subdomainUrlPattern()}`)
      .limit(1)
    if (depErr) throw new CronLookupError(`legacy deployments for ${id}: ${depErr.message}`)
    if (!live || live.length === 0) continue

    // Audit R7: the free trial is once per USER. A legacy live store whose owner already
    // used their trial elsewhere gets only a short grace window (so the 7d/1d reminders
    // still fire before suspension) instead of a fresh 30-day trial.
    const { data: owner } = await supabaseAdmin
      .from('projects')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    const ownerId = (owner as { user_id?: string } | null)?.user_id ?? ''
    const used = ownerId ? await hasUsedHostingTrial(ownerId, id) : null
    const windowMs = used === false ? TRIAL_MS : LEGACY_GRACE_MS

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('projects')
      .update({ hosting_trial_ends_at: new Date(Date.now() + windowMs).toISOString() })
      .eq('id', id)
      .is('hosting_trial_ends_at', null)
      .select('id')
    if (updErr) {
      console.error(`[cron/hosting] failed to start trial for ${id}:`, updErr)
      continue
    }
    if (updated && updated.length > 0) stats.trialsStarted++
  }
  return rows.length
}

interface ProjectDomainRow {
  id: string
  custom_domain: string | null
  custom_domain_verified: boolean | null
}

// custom_domain_verified is proof of control over the name (it keeps the claim past the
// unverified-claim window and blocks other users from its parents / children), so it
// follows the live DNS: true only while the zone points at Vercel. An unknown answer
// (Vercel lookup failed) leaves the flag untouched.
async function refreshProjectDomainProofs(
  rows: ProjectDomainRow[],
  stats: Stats,
  outOfTime: () => boolean,
): Promise<number> {
  for (let i = 0; i < rows.length; i++) {
    if (outOfTime()) return i
    const row = rows[i]
    if (!row.custom_domain) continue
    const configured = await getDomainDnsConfigured(row.custom_domain)
    if (configured === null || configured === (row.custom_domain_verified === true)) continue
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ custom_domain_verified: configured })
      .eq('id', row.id)
      .eq('custom_domain', row.custom_domain)
    if (error) {
      console.error(`[cron/hosting] could not refresh custom_domain_verified for ${row.id}:`, error.message)
      continue
    }
    await supabaseAdmin
      .from('deployments')
      .update({ custom_domain_verified: configured })
      .eq('project_id', row.id)
      .eq('custom_domain', row.custom_domain)
    stats.domainProofsUpdated++
  }
  return rows.length
}

// Same for connect-only user_domains rows. Rows bought through Quante prove the claim
// by the registration itself and are skipped.
async function refreshUserDomainProofs(
  rows: DomainRow[],
  stats: Stats,
  outOfTime: () => boolean,
): Promise<number> {
  for (let i = 0; i < rows.length; i++) {
    if (outOfTime()) return i
    const row = rows[i]
    if (!isLiveStatus(row.status) || isQuanteRegistered(row)) continue
    const configured = await getDomainDnsConfigured(row.domain)
    if (configured === null || configured === (row.dns_verified === true)) continue
    const { error } = await supabaseAdmin
      .from('user_domains')
      .update({ dns_verified: configured, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', row.status)
    if (error) {
      console.error(`[cron/hosting] could not refresh dns_verified for ${row.id}:`, error.message)
      continue
    }
    stats.domainProofsUpdated++
  }
  return rows.length
}

// Inserts the dedup row; returns false when this reminder was already sent.
async function claimReminder(projectId: string, kind: string, refDate: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('hosting_reminders')
    .upsert(
      { project_id: projectId, kind, ref_date: refDate },
      { onConflict: 'project_id,kind,ref_date', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error('[cron/hosting] claimReminder error:', error)
    return false
  }
  return !!data && data.length > 0
}

async function getOwnerEmail(userId: string): Promise<string | null> {
  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    return user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null
  } catch (err) {
    console.error('[cron/hosting] failed to get owner email:', err)
    return null
  }
}
