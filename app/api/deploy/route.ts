import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildStoreFiles, toStoreSlug, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import { CREDIT_COSTS } from '@/lib/config'
import { debitCredits, refundDebit } from '@/lib/credits'
import { getOwnedProject } from '@/lib/auth/project'
import { getHostingGate, hasUsedHostingTrial, claimHostingTrial, releaseHostingTrial } from '@/lib/hosting/gate'
import {
  ensureProjectVercel,
  getOrClaimStoreSlug,
  createDeployment,
  createVercelPreviewDeploy,
  getDeploymentStatus,
  getBuildError,
  attachDomain,
  HOSTING_ROOT_DOMAIN,
} from '@/lib/hosting/vercel'
import type { CodeVersionFiles } from '@/types/store-code'
import { insertDeploymentRow } from '@/lib/hosting/deployments'
import { platformApiUrl, ensureStoreApiKey, setStoreConnectionEnv } from '@/lib/hosting/store-env'

export const maxDuration = 60

// Deploy is gated on an active hosting plan (a 30-day trial on the user's first
// live store only — once per user, audit R7 — then a hosting_subscriptions row with status
// 'active' or 'trialing'), not on a credit balance — see getHostingGate
// below. Users without a plan hit the existing 402 SUBSCRIPTION_REQUIRED
// upsell path; users with a plan pay 0 credits per deploy. Preview deploy
// stays at 2 credits (short-lived preview URL, no subdomain, used for
// validation without touching the live store).
const PREVIEW_DEPLOY_COST = CREDIT_COSTS.preview_deploy
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

const TRIAL_MS = 30 * 24 * 60 * 60 * 1000

// Free production deploys are throttled per user (mirrors the redeploy route).
const DEPLOY_WINDOW_MS = 10 * 60 * 1000
const MAX_DEPLOYS_PER_WINDOW = 20

// Vercel deployment ids look like dpl_<base62>. Anything else is rejected before it
// reaches a Vercel API path.
const DEPLOYMENT_ID_RE = /^dpl_[A-Za-z0-9]+$/

// platformApiUrl() — the URL the deployed store calls back to (fails closed; https only,
// except localhost) — lives in lib/hosting/store-env.ts, shared with the scaffold rollout.

// ─── First-deploy trial release ───────────────────────────────────────────────
// A first Push to Live stamps hosting_trial_ends_at (and claims the user's one free
// trial) before the build starts. If that build never produces a live store, the stamp
// and claim are handed back so a failed first build does not burn the once-per-user
// trial (audit R7 follow-up). Every production deploy writes a deployments row, and
// production auto-deploys only run once the project is everLive (i.e. after the stamp),
// so "no other non-failed deployment row since the stamp" means nothing can be live.

// Allowed drift between this server's clock (the stamp) and the DB's (created_at).
const CLOCK_SKEW_MS = 30 * 1000
// A first Push to Live stamps, creates the deployment and inserts its row in one
// request (maxDuration 60s); a stamp further than this from the row is not from it.
const STAMP_TO_ROW_MS = 5 * 60 * 1000

/** Any deployment of this project since `sinceMs` that may be (or become) live? Fails safe (true). */
async function hasOtherPossiblyLiveDeploys(
  projectId: string,
  excludeRowId: string | null,
  sinceMs: number,
): Promise<boolean> {
  let q = supabaseAdmin
    .from('deployments')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('created_at', new Date(sinceMs - CLOCK_SKEW_MS).toISOString())
    .not('status', 'in', '(error,canceled)')
  if (excludeRowId) q = q.neq('id', excludeRowId)
  const { count, error } = await q
  if (error) {
    console.error('[deploy] live-deploy lookup failed (keeping hosting trial stamp):', error.message)
    return true
  }
  return (count ?? 0) > 0
}

/**
 * Called when a production deployment row settles as error/canceled. Releases the
 * project's trial stamp + claim only when this deployment was the project's first live
 * deploy (the stamp was written by the request that created it) and nothing else of the
 * project may be live. Best-effort: never throws.
 */
async function releaseTrialIfFirstLiveDeployFailed(
  userId: string,
  row: { id: string; project_id: string; domain: string | null; created_at: string | null },
  deploymentId: string,
): Promise<void> {
  try {
    if (!row.domain || !row.created_at) return // preview rows carry no domain
    const project = await getOwnedProject<{
      id: string
      hosting_trial_ends_at: string | null
      hosting_suspended_at: string | null
    }>(row.project_id, userId, 'id, hosting_trial_ends_at, hosting_suspended_at')
    if (!project?.hosting_trial_ends_at || project.hosting_suspended_at) return

    const rowMs = Date.parse(row.created_at)
    const endsMs = Date.parse(project.hosting_trial_ends_at)
    if (!Number.isFinite(rowMs) || !Number.isFinite(endsMs)) return
    // The stamp is either "now" (no free trial) or "now + 30 days" at stamp time.
    const stampedAtMs = [endsMs, endsMs - TRIAL_MS].find(
      (t) => t <= rowMs + CLOCK_SKEW_MS && rowMs - t <= STAMP_TO_ROW_MS,
    )
    if (stampedAtMs === undefined) return // not this deployment's stamp

    if (await hasOtherPossiblyLiveDeploys(row.project_id, row.id, stampedAtMs)) return

    // The row's status may have been written by the log stream; confirm with Vercel.
    const status = await getDeploymentStatus(deploymentId)
    if (status.state !== 'error' && status.state !== 'canceled') return

    if (await releaseHostingTrial(userId, row.project_id, project.hosting_trial_ends_at)) {
      console.log('[deploy] first live deploy failed — hosting trial handed back', { project: row.project_id })
    }
  } catch (err) {
    console.error('[deploy] trial release check failed:', err)
  }
}

// ─── POST /api/deploy ─────────────────────────────────────────────────────────
// Kick off a deployment. Returns immediately with { deploymentId, domain }.
// The client polls GET /api/deploy/status?id=<deploymentId> for updates.

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; type?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const projectId = body.projectId
  const type = body.type ?? 'production'
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (type !== 'preview' && type !== 'production') {
    return NextResponse.json({ error: 'Invalid deploy type' }, { status: 400 })
  }

  // Ownership check (service-role client — RLS does not protect us here).
  const project = await getOwnedProject<{ id: string; name: string | null }>(projectId, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // ── Preview deploy path (2 credits, unique Vercel URL, no subdomain) ──────────
  if (type === 'preview') {
    const { data: version } = await supabaseAdmin
      .from('code_versions').select('id, files, version_no').eq('project_id', project.id).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!version) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })

    // Deployment *name* only (no subdomain is attached to a preview). Never derived
    // from AI-written data/config.ts.
    const deploymentName = toStoreSlug(project.name ?? '') || 'store'

    // SECURITY (audit #35): debit atomically BEFORE the Vercel build so concurrent
    // requests can't each pass a stale balance check; refund if the build never starts.
    const debitRef = randomUUID()
    const debit = await debitCredits(userId, PREVIEW_DEPLOY_COST, 'preview_deploy', debitRef)
    if (!debit.ok) {
      if (debit.error === 'insufficient_credits') {
        return NextResponse.json(
          { error: `Insufficient credits. Need ${PREVIEW_DEPLOY_COST}, have ${debit.balance ?? 0}.` },
          { status: 402 },
        )
      }
      if (debit.error === 'billing_hold') {
        return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
      }
      return NextResponse.json({ error: 'Could not reserve credits. Please try again.' }, { status: 503 })
    }
    const refund = () => refundDebit(userId, debitRef, 'preview_deploy', 'preview_deploy_failed')

    let vercelProjectId: string
    try {
      vercelProjectId = await ensureProjectVercel(project.id)
    } catch (err) {
      console.error('[deploy/preview] ensureProjectVercel failed:', err)
      await refund()
      return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
    }

    let files
    try { files = buildStoreFiles(version.files as Record<string, string>) }
    catch (err) {
      console.error('[deploy/preview] buildStoreFiles failed:', err)
      await refund()
      return NextResponse.json({ error: 'Failed to build store files.' }, { status: 500 })
    }

    let deploymentId: string, previewUrl: string
    try {
      const r = await createVercelPreviewDeploy(
        vercelProjectId,
        files.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
        deploymentName,
      )
      deploymentId = r.deploymentId
      previewUrl = r.url
    } catch (err) {
      console.error('[deploy/preview] createVercelPreviewDeploy failed:', err)
      await refund()
      return NextResponse.json({ error: 'Failed to start preview deployment.' }, { status: 500 })
    }

    const { error: previewInsertErr } = await insertDeploymentRow({
      project_id: project.id, user_id: userId,
      vercel_project_id: vercelProjectId, vercel_deployment_id: deploymentId,
      status: 'building', url: previewUrl, domain: null,
      version: version.version_no, code_version_id: version.id,
      target: 'preview', scaffold_version: SCAFFOLD_VERSION,
    })
    if (previewInsertErr) console.error('[deploy/preview] failed to insert deployment row:', previewInsertErr)

    return NextResponse.json({ deploymentId, previewUrl, type: 'preview' })
  }

  // ── Production (Push to Live) ────────────────────────────────────────────────
  // SECURITY (audit #7/#16): one shared gate — trial, subscription, Agency plan and
  // suspension. Fails closed on lookup errors.
  const gate = await getHostingGate(project.id)
  if (!gate.canDeployProduction) {
    if (gate.reason === 'trial_expired' || gate.reason === 'suspended' || gate.reason === 'trial_used') {
      return NextResponse.json(
        {
          error: gate.reason === 'suspended'
            ? 'Hosting for this store is suspended. Subscribe to bring it back online.'
            : gate.reason === 'trial_used'
              ? 'Your free 30-day hosting trial was already used on another store. Subscribe to put this store live.'
              : 'Your 30-day free trial has ended. Subscribe to continue hosting.',
          code: 'SUBSCRIPTION_REQUIRED',
        },
        { status: 402 },
      )
    }
    if (gate.reason === 'project_not_found' || gate.reason === 'invalid_project') {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Could not verify your hosting plan. Please try again.' }, { status: 503 })
  }

  // Production deploy no longer costs credits — hosting-plan-gated (see gate above).
  // Because it is free, cap how many Vercel production builds a user can trigger
  // (same window/limit as /api/projects/[id]/redeploy; the count spans both routes).
  const since = new Date(Date.now() - DEPLOY_WINDOW_MS).toISOString()
  const { count: recentDeploys, error: countErr } = await supabaseAdmin
    .from('deployments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  if (countErr) {
    console.error('[deploy] deploy throttle lookup failed:', countErr)
    return NextResponse.json({ error: 'Could not start deployment right now. Please try again.' }, { status: 503 })
  }
  if ((recentDeploys ?? 0) >= MAX_DEPLOYS_PER_WINDOW) {
    return NextResponse.json({ error: 'Too many deployments. Please wait a few minutes.' }, { status: 429 })
  }

  const appUrl = platformApiUrl()
  if (!appUrl) {
    console.error('[deploy] NEXT_PUBLIC_APP_URL is missing or not https — refusing to deploy a store without a platform URL')
    return NextResponse.json({ error: 'Deployments are temporarily unavailable.' }, { status: 503 })
  }

  // Load latest code version (only rows written by the owner — service-role client)
  const { data: version } = await supabaseAdmin
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', project.id)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) {
    return NextResponse.json({ error: 'No generated store found. Generate a store first.' }, { status: 404 })
  }

  const codeFiles = version.files as CodeVersionFiles

  // Build file tree: scaffold + AI-generated code files merged on top
  let files
  try {
    files = buildStoreFiles(codeFiles)
  } catch (err) {
    console.error('[deploy] buildStoreFiles failed:', err)
    return NextResponse.json({ error: 'Failed to build store files.' }, { status: 500 })
  }

  // SECURITY (audit #0/#38): the Vercel project is bound to this Quante project's
  // UUID and the subdomain is this project's permanently claimed, unique store_slug.
  // Neither is ever derived from the AI-written data/config.ts brand name.
  let vercelProjectId: string
  let slug: string
  try {
    slug = await getOrClaimStoreSlug(project.id, project.name ?? '')
    vercelProjectId = await ensureProjectVercel(project.id)
  } catch (err) {
    console.error('[deploy] hosting provisioning failed:', err)
    return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
  }

  const intendedDomain = `${slug}.${HOSTING_ROOT_DOMAIN}`

  // Generate / retrieve per-project API key for store → Quante communication
  // (shared with the scaffold rollout: lib/hosting/store-env.ts).
  let quanteApiKey: string
  try {
    quanteApiKey = await ensureStoreApiKey(project.id, userId)
  } catch (err) {
    // A key the store holds but Quante doesn't know would break managed checkout.
    console.error('[deploy] failed to persist project secrets:', err)
    return NextResponse.json({ error: 'Failed to prepare store credentials.' }, { status: 500 })
  }

  // Managed payments — store calls back to Quante, no Stripe keys in deployed store
  try {
    await setStoreConnectionEnv(vercelProjectId, project.id, appUrl, quanteApiKey)
  } catch (err) {
    console.warn('[deploy] setEnvVars failed (non-fatal):', err)
  }

  // SECURITY (audit #16): start the 30-day hosting trial server-side on the first live
  // deploy — not when (or if) the client polls the status endpoint. Idempotent: only the
  // first live deploy sets it (`.is('hosting_trial_ends_at', null)`).
  // SECURITY (audit R7): the trial is once per USER. It is taken with a per-user
  // compare-and-set (claimHostingTrial → hosting_trials PK) so concurrent first deploys
  // of several projects cannot each get one. A project that goes live on a
  // subscription / Agency plan after its owner already used the trial is stamped with
  // "now": it becomes everLive (tracked by the hosting cron, eligible for auto-deploys)
  // but gets no free days. A user who lost the claim race and has no plan is refused.
  // This runs BEFORE the Vercel deployment is created: if the stamp cannot be written
  // nothing is deployed (a live store with no stamp would otherwise be picked up by the
  // hosting cron's legacy pass), and if the deployment cannot be created the stamp and
  // claim are released again (releaseHostingTrial) so the user keeps their trial.
  let stampedTrialEndsAt: string | null = null
  let stampedAtMs = 0
  if (!gate.everLive) {
    let startTrial = gate.trialEligible === true
    let claimedTrial = false
    if (startTrial) {
      const claim = await claimHostingTrial(userId, project.id)
      if (claim === 'error') {
        return NextResponse.json({ error: 'Could not verify your hosting plan. Please try again.' }, { status: 503 })
      }
      if (claim === 'claimed') claimedTrial = true
      else if (claim === 'used') startTrial = false
      else {
        // Migration not run yet — best-effort re-check (the old behaviour). If this
        // lookup fails we keep the gate's answer (it already succeeded moments ago).
        const usedNow = await hasUsedHostingTrial(userId, project.id)
        if (usedNow === true) startTrial = false
      }
    }
    if (!startTrial && !gate.hasActiveSubscription && !gate.agency) {
      // Same 402 shape the gate refusal above uses (the Studio's Subscribe flow keys on it).
      return NextResponse.json(
        {
          error: 'Your free 30-day hosting trial was already used on another store. Subscribe to put this store live.',
          code: 'SUBSCRIPTION_REQUIRED',
        },
        { status: 402 },
      )
    }

    stampedAtMs = Date.now()
    const stampValue = new Date(stampedAtMs + (startTrial ? TRIAL_MS : 0)).toISOString()
    const { data: stamped, error: trialErr } = await supabaseAdmin
      .from('projects')
      .update({ hosting_trial_ends_at: stampValue })
      .eq('id', project.id)
      .is('hosting_trial_ends_at', null)
      .select('id')
    if (trialErr) {
      console.error('[deploy] failed to start hosting trial:', trialErr)
      if (claimedTrial) await releaseHostingTrial(userId, project.id, null)
      return NextResponse.json({ error: 'Could not start hosting for this store. Please try again.' }, { status: 503 })
    }
    // 0 rows = a concurrent Push to Live of this same project stamped it first; that
    // request owns the stamp (and its release on failure).
    if (stamped && stamped.length > 0) stampedTrialEndsAt = stampValue
  }

  // Create the Vercel deployment
  let deploymentId: string
  let vercelUrl: string
  try {
    const result = await createDeployment(vercelProjectId, files, { target: 'production', projectSlug: slug })
    deploymentId = result.deploymentId
    vercelUrl = result.url
  } catch (err) {
    console.error('[deploy] createDeployment failed:', err)
    // Nothing went live — hand the first-deploy stamp/claim back, unless another
    // production deploy of this project already exists (then it may be live).
    if (stampedTrialEndsAt && !(await hasOtherPossiblyLiveDeploys(project.id, null, stampedAtMs))) {
      await releaseHostingTrial(userId, project.id, stampedTrialEndsAt)
    }
    return NextResponse.json({ error: 'Failed to start deployment.' }, { status: 500 })
  }

  // Persist deployment row (domain set so the hosting cron sees the store as live)
  const { id: deployRowId, error: insertErr } = await insertDeploymentRow({
    project_id: project.id,
    user_id: userId,
    vercel_project_id: vercelProjectId,
    vercel_deployment_id: deploymentId,
    status: 'building',
    url: vercelUrl.startsWith('https://') ? vercelUrl : `https://${vercelUrl}`,
    domain: intendedDomain,
    version: version.version_no,
    code_version_id: version.id,
    target: 'production',
    scaffold_version: SCAFFOLD_VERSION,
  })

  if (insertErr || !deployRowId) {
    console.error('[deploy] failed to insert deployment row:', insertErr)
    // Deployment is still running on Vercel — log but don't abort
  }

  return NextResponse.json({
    deploymentId,
    dbId: deployRowId,
    domain: intendedDomain,
    status: 'building',
  })
}

// ─── GET /api/deploy/status?id=<deploymentId> ─────────────────────────────────
// Check the current state of a deployment. Transitions building→ready/error and
// attaches the domain.

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const deploymentId = searchParams.get('id')
  if (!deploymentId) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (!DEPLOYMENT_ID_RE.test(deploymentId)) {
    return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })
  }

  // Ownership: the deployment row must belong to the caller (service-role client).
  const { data: row } = await supabaseAdmin
    .from('deployments')
    .select('id, project_id, vercel_project_id, vercel_deployment_id, status, url, domain, error_message, version, version_id, created_at')
    .eq('user_id', userId)
    .eq('vercel_deployment_id', deploymentId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })

  // Already settled — return cached state
  if (row.status === 'ready' || row.status === 'error' || row.status === 'canceled') {
    // The log stream (/api/deploy/logs) may have settled a failed first live deploy
    // before this poll saw it — hand the hosting trial back here too.
    if (row.status !== 'ready' && row.domain) {
      await releaseTrialIfFirstLiveDeployFailed(userId, row, deploymentId)
    }
    const safeUrl = (row.url && !row.url.includes('://null')) ? row.url : null
    return NextResponse.json({
      status: row.status,
      url: safeUrl,
      domain: row.domain,
      errorMessage: row.error_message,
    })
  }

  // Poll Vercel for current state
  let vercelStatus
  try {
    vercelStatus = await getDeploymentStatus(deploymentId)
  } catch (err) {
    console.error('[deploy/status] getDeploymentStatus failed:', err)
    return NextResponse.json({ status: row.status, url: row.url, domain: row.domain })
  }

  if (vercelStatus.state === 'building' || vercelStatus.state === 'queued') {
    return NextResponse.json({ status: vercelStatus.state, url: row.url, domain: row.domain })
  }

  if (vercelStatus.state === 'error' || vercelStatus.state === 'canceled') {
    const errorMessage = vercelStatus.state === 'error'
      ? await getBuildError(deploymentId)
      : 'Deployment was canceled.'
    await supabaseAdmin
      .from('deployments')
      .update({ status: vercelStatus.state, error_message: errorMessage, updated_at: new Date().toISOString() })
      .eq('id', row.id)

    if (row.domain) await releaseTrialIfFirstLiveDeployFailed(userId, row, deploymentId)

    return NextResponse.json({ status: vercelStatus.state, errorMessage })
  }

  if (vercelStatus.state === 'ready') {
    const domain = row.domain as string | null
    let finalUrl = vercelStatus.url ?? row.url

    // Only attach domain for production deploys (preview deploys have domain = null)
    // Always use subdomain URL once domain is added — verified=false just means DNS
    // isn't confirmed yet, Vercel starts routing once propagation completes.
    // SECURITY (audit #38): attachDomain already treats "already on THIS project" as
    // success; any error left means the host is not ours, so we must NOT report it as
    // the store's URL (that would show the merchant another tenant's site).
    let attachedDomain: string | null = null
    if (domain) {
      try {
        await attachDomain(row.vercel_project_id as string, domain)
        finalUrl = `https://${domain}`
        attachedDomain = domain
      } catch (err) {
        console.error('[deploy/status] attachDomain failed — subdomain unavailable for this project:', err)
      }
    }

    // Update deployment row. When the attach failed, `domain` is cleared too: every
    // later poll returns the settled row's domain, and the hosting cron reads it as the
    // store's live host (billing-email store links) — neither may keep advertising a
    // host this project does not serve. (Production-deploy detection in the cron is
    // defense in depth only; POST already gates production deploys via getHostingGate
    // and starts the trial there.)
    await supabaseAdmin
      .from('deployments')
      .update({
        status: 'ready',
        url: finalUrl,
        ...(domain && !attachedDomain ? { domain: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    // The hosting trial is started server-side in POST when the production
    // deployment is created (audit #16) — it no longer depends on this poll.

    return NextResponse.json({ status: 'ready', url: finalUrl, domain: attachedDomain })
  }

  return NextResponse.json({ status: row.status })
}
