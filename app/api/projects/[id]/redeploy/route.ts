import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildStoreFiles, toStoreSlug, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import { insertDeploymentRow, isDraftPublishReady } from '@/lib/hosting/deployments'
import {
  ensureProjectVercel,
  getOrClaimStoreSlug,
  createPreviewDeployment,
  createStagedDeployment,
  createVercelPreviewDeploy,
  getDeploymentStatus,
} from '@/lib/hosting/vercel'
import { getOwnedProject } from '@/lib/auth/project'
import { getHostingGate } from '@/lib/hosting/gate'
import type { CodeVersionFiles } from '@/types/store-code'
import { classifyDeploymentRow, hashCodeFiles } from './_lib/build-match'

export const maxDuration = 120

// This route is free, so cap how many Vercel builds a user can trigger through it.
// Both windows count every deployments row the user created (deploy, redeploy,
// iterate/fix auto-deploys), so restore → redeploy loops can't churn Vercel.
const REDEPLOY_WINDOW_MS = 10 * 60 * 1000
const MAX_DEPLOYS_PER_WINDOW = 20
const REDEPLOY_HOUR_MS = 60 * 60 * 1000
const MAX_DEPLOYS_PER_HOUR = 40

interface Params { params: Promise<{ id: string }> }

// How far back (deployments rows of this project) to look for a build of identical
// content, and how many Vercel status lookups one request may spend confirming them.
const MATCH_LOOKBACK_ROWS = 25
const MAX_STATUS_LOOKUPS = 6

type ExistingBuild =
  | { state: 'none' }
  | { state: 'building' }
  | { state: 'lookup_failed' }
  | { state: 'ready'; deploymentId: string; url: string }

interface DeploymentRow {
  id: string
  vercel_deployment_id: string | null
  status: string | null
  created_at: string | null
  code_version_id: string | null
  url: string | null
}

function vercelStatusCode(err: unknown): number | undefined {
  const code = (err as { statusCode?: unknown } | null)?.statusCode
  return typeof code === 'number' ? code : undefined
}

/**
 * Has content identical to the latest code version already been built for this project?
 * Matched by a content hash (hashCodeFiles) across every recent code version with a
 * non-failed deployment — not by version id, which restore / product edits reset for
 * free. Each candidate is confirmed with Vercel (DB rows only settle when someone polls
 * /api/deploy or streams its logs) and settled states are written back. Fails closed
 * ('lookup_failed') on DB errors and on Vercel lookup errors for fresh or READY rows.
 */
async function findExistingBuild(
  projectId: string,
  userId: string,
  current: { id: string; files: unknown },
): Promise<ExistingBuild> {
  const { data: rowData, error } = await supabaseAdmin
    .from('deployments')
    .select('id, vercel_deployment_id, status, created_at, code_version_id, url')
    .eq('project_id', projectId)
    .not('code_version_id', 'is', null)
    .not('status', 'in', '(error,canceled)')
    .order('created_at', { ascending: false })
    .limit(MATCH_LOOKBACK_ROWS)
  if (error) {
    console.error('[redeploy] build-state lookup failed:', error.message)
    return { state: 'lookup_failed' }
  }
  const rows = ((rowData ?? []) as DeploymentRow[]).filter((r) => r.vercel_deployment_id)
  if (rows.length === 0) return { state: 'none' }

  let lookups = 0
  let building = false
  let lookupFailed = false

  // Confirms candidate rows with Vercel (DB-ready ones first, newest first within each
  // group) and returns the first working deployment, if any.
  const evaluate = async (candidates: DeploymentRow[]): Promise<ExistingBuild | null> => {
    const ordered = [...candidates].sort(
      (a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'),
    )
    for (const r of ordered) {
      if (lookups >= MAX_STATUS_LOOKUPS) return null
      lookups++
      const vercelId = r.vercel_deployment_id as string
      const ageMs = r.created_at ? Date.now() - Date.parse(r.created_at) : NaN
      let vercelState: string | null = null
      let lookupStatus: number | undefined
      let vercelUrl: string | undefined
      try {
        const s = await getDeploymentStatus(vercelId)
        vercelState = s.state
        vercelUrl = s.url
      } catch (err) {
        lookupStatus = vercelStatusCode(err)
        console.error('[redeploy] Vercel status lookup failed:', err)
      }
      const verdict = classifyDeploymentRow({ vercelState, lookupStatus, ageMs, dbReady: r.status === 'ready' })

      // Write settled results back for rows the DB still shows as in progress.
      if (r.status !== 'ready') {
        const settled = vercelState === 'ready' || vercelState === 'error' || vercelState === 'canceled'
          ? vercelState
          : lookupStatus === 404 ? 'error' : null
        if (settled) {
          await supabaseAdmin
            .from('deployments')
            .update({ status: settled, updated_at: new Date().toISOString() })
            .eq('id', r.id)
        }
      }

      if (verdict === 'ready') {
        const url = vercelUrl ?? r.url
        if (url) {
          return { state: 'ready', deploymentId: vercelId, url: url.startsWith('https://') ? url : `https://${url}` }
        }
      }
      if (verdict === 'building') building = true
      if (verdict === 'lookup_failed') lookupFailed = true
    }
    return null
  }

  // 1. Deployments of the latest version itself (cheap — no file loads).
  const own = await evaluate(rows.filter((r) => r.code_version_id === current.id))
  if (own) return own

  // 2. Other versions of this project with identical content (restore, no-op product
  //    edit, …) — each of those writes a new version id for free.
  const otherIds = [...new Set(
    rows.map((r) => r.code_version_id as string).filter((vid) => vid !== current.id),
  )]
  if (otherIds.length > 0 && lookups < MAX_STATUS_LOOKUPS) {
    const { data: versions, error: vErr } = await supabaseAdmin
      .from('code_versions')
      .select('id, files')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .in('id', otherIds)
    if (vErr) {
      console.error('[redeploy] code version lookup failed:', vErr.message)
      return { state: 'lookup_failed' }
    }
    const currentHash = hashCodeFiles(current.files)
    const matching = new Set(
      ((versions ?? []) as Array<{ id: string; files: unknown }>)
        .filter((v) => hashCodeFiles(v.files) === currentHash)
        .map((v) => v.id),
    )
    if (matching.size > 0) {
      const other = await evaluate(rows.filter((r) => matching.has(r.code_version_id as string)))
      if (other) return other
    }
  }

  if (lookupFailed) return { state: 'lookup_failed' }
  if (building) return { state: 'building' }
  return { state: 'none' }
}

// POST /api/projects/[id]/redeploy
// Re-deploys the current code version — free, no Claude call.
// Used by "Rebuild preview" button and after version restore. Preview-only builds are
// only made for content that has no working build yet (audit F4, see below).
//
// SECURITY (audit #7): this used to deploy straight to production (public subdomain)
// with no hosting check, so "Rebuild preview" gave free hosting and undid suspension.
// Production is now used only when the store has already gone live via Push to Live
// AND the hosting gate allows it; otherwise it is a true preview (no target, no
// subdomain).

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check (service-role client — RLS does not protect us here)
  const project = await getOwnedProject<{ id: string; name: string | null }>(id, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // DB-backed per-user caps (fail closed: a lookup error must not open the throttle).
  const countDeploysSince = (ms: number) => supabaseAdmin
    .from('deployments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - ms).toISOString())
  const [windowRes, hourRes] = await Promise.all([
    countDeploysSince(REDEPLOY_WINDOW_MS),
    countDeploysSince(REDEPLOY_HOUR_MS),
  ])
  if (windowRes.error || hourRes.error) {
    console.error('[redeploy] deploy throttle lookup failed:', windowRes.error ?? hourRes.error)
    return NextResponse.json({ error: 'Could not start deployment right now. Please try again.' }, { status: 503 })
  }
  if ((windowRes.count ?? 0) >= MAX_DEPLOYS_PER_WINDOW || (hourRes.count ?? 0) >= MAX_DEPLOYS_PER_HOUR) {
    return NextResponse.json({ error: 'Too many deployments. Please wait a few minutes.' }, { status: 429 })
  }

  // Load latest code version (only rows written by the owner — service-role client)
  const { data: current } = await supabaseAdmin
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', project.id)
    .eq('user_id', userId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!current) return NextResponse.json({ error: 'No code version found.' }, { status: 404 })

  const codeFiles = current.files as CodeVersionFiles

  const gate = await getHostingGate(project.id)
  const toProduction = gate.everLive && gate.canDeployProduction
  // Draft/publish (2026-09-26): a rebuild of a live store is a staged draft — the owner
  // publishes it explicitly (app/api/projects/[id]/publish). Direct production only
  // until migration-draft-publish.sql has run.
  const staged = toProduction && await isDraftPublishReady()

  // SECURITY (audit F4): a preview-only build (never-live store, or a store that went
  // live but may not deploy to production now — suspended / trial over) is exactly what
  // the paid Preview (/api/deploy type 'preview', CREDIT_COSTS.preview_deploy) builds.
  // It stays free only for content that has no working build yet: if identical content
  // (same files hash, whatever version id restore / product edits gave it) already has a
  // READY deployment, that preview is handed back without a new build; if one is still
  // running, the caller waits. Stuck / vanished builds count as dead after
  // STALE_BUILD_MS so the Studio's "Rebuild preview" retry keeps working. Production
  // redeploys of live, paid-up stores are unchanged.
  if (!toProduction) {
    const existing = await findExistingBuild(project.id, userId, { id: current.id as string, files: current.files })
    if (existing.state === 'lookup_failed') {
      return NextResponse.json({ error: 'Could not start deployment right now. Please try again.' }, { status: 503 })
    }
    if (existing.state === 'ready') {
      return NextResponse.json({ deploymentId: existing.deploymentId, previewUrl: existing.url, reused: true })
    }
    if (existing.state === 'building') {
      return NextResponse.json(
        { error: 'A build of this version is already running. Please wait for it to finish.', code: 'build_in_progress' },
        { status: 409 },
      )
    }
  }

  let vercelProjectId: string
  let storeSlug: string | null = null
  try {
    vercelProjectId = await ensureProjectVercel(project.id)
    // Subdomain only for production; never derived from AI-written data/config.ts.
    if (toProduction) storeSlug = await getOrClaimStoreSlug(project.id, project.name ?? '')
  } catch (err) {
    console.error('[redeploy] hosting provisioning failed:', err)
    return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
  }

  let allFiles
  try {
    allFiles = buildStoreFiles(codeFiles)
  } catch (err) {
    console.error('[redeploy] buildStoreFiles failed:', err)
    return NextResponse.json({ error: 'Failed to build store files.' }, { status: 500 })
  }
  const deployFiles = allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' }))

  let deploymentId: string
  let previewUrl: string
  try {
    const result = staged && storeSlug
      ? await createStagedDeployment(vercelProjectId, deployFiles, storeSlug)
      : toProduction && storeSlug
        ? await createPreviewDeployment(vercelProjectId, deployFiles, storeSlug)
        : await createVercelPreviewDeploy(vercelProjectId, deployFiles, toStoreSlug(project.name ?? '') || 'store')
    deploymentId = result.deploymentId
    previewUrl = result.url
  } catch (err) {
    console.error('[redeploy] deployment failed:', err)
    return NextResponse.json({ error: 'Deployment failed.' }, { status: 500 })
  }

  const { error: insertErr } = await insertDeploymentRow({
    project_id: project.id,
    user_id: userId,
    vercel_project_id: vercelProjectId,
    vercel_deployment_id: deploymentId,
    status: 'building',
    url: previewUrl.startsWith('https://') ? previewUrl : `https://${previewUrl}`,
    domain: null,
    version: current.version_no,
    code_version_id: current.id,
    target: staged && storeSlug ? 'staged' : toProduction && storeSlug ? 'production' : 'preview',
    scaffold_version: SCAFFOLD_VERSION,
  })
  if (insertErr) console.error('[redeploy] failed to insert deployment row:', insertErr)

  return NextResponse.json({ deploymentId, previewUrl, staged: staged && !!storeSlug })
}
