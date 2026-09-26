// Draft / publish for live code-gen stores (2026-09-26).
//
// Chat edits, auto-fixes and rebuilds of a live store are STAGED builds (production
// target, domains not assigned — app/api/quante/iterate/deploy.ts). This route shows
// what is published vs. drafted and publishes the latest code version:
//   - a READY staged build of it exists (current scaffold) → Vercel promote: the store's
//     domains switch to that exact build within seconds, no rebuild;
//   - otherwise → { mode: 'rebuild' }: the Studio falls back to Push to Live
//     (POST /api/deploy), a full production build of the latest version.
// Publishing an older version = Restore it in the version history (it becomes the
// latest, gets a staged build) and publish that.
//
// GET  → { draftPublishReady, everLive, canPublish, reason?, live, latest, upToDate, staged }
// POST → { mode: 'promoted' | 'up_to_date' | 'rebuild', url?, versionNo? } or an error
//        (409 draft_building / production_build_in_progress, 402 SUBSCRIPTION_REQUIRED).

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { getHostingGate } from '@/lib/hosting/gate'
import { isDraftPublishReady, isUnknownColumnError } from '@/lib/hosting/deployments'
import {
  HOSTING_ROOT_DOMAIN,
  getDeploymentStatus,
  getOrClaimStoreSlug,
  promoteDeployment,
} from '@/lib/hosting/vercel'
import { productionRowsNewestFirst, type RolloutDeploymentRow } from '@/lib/hosting/scaffold-rollout-rules'
import { SCAFFOLD_VERSION } from '@/lib/store-template/build'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

interface Params { params: Promise<{ id: string }> }

// Production builds (Push to Live, scaffold rollout, restore) still running after this
// long are treated as dead — Vercel times builds out well before.
const PRODUCTION_BUILD_FRESH_MS = 15 * 60 * 1000
const MAX_STATUS_LOOKUPS = 3

interface VersionRow { id: string; version_no: number; created_at: string; prompt: string | null }
interface StagedRow {
  id: string
  vercel_project_id: string | null
  vercel_deployment_id: string | null
  status: string | null
  url: string | null
  scaffold_version: number | null
  created_at: string
}

async function loadLatestVersion(projectId: string): Promise<VersionRow | null> {
  const { data } = await supabaseAdmin
    .from('code_versions')
    .select('id, version_no, created_at, prompt')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as VersionRow | null) ?? null
}

/** The live (published) build — same rules as the checkout pricing and the scaffold rollout. DB only. */
async function loadLiveRow(projectId: string): Promise<RolloutDeploymentRow | null> {
  const query = (columns: string) => supabaseAdmin
    .from('deployments')
    .select(columns)
    .eq('project_id', projectId)
    .eq('status', 'ready')
    .or('target.is.null,target.eq.production')
    .order('created_at', { ascending: false })
    .limit(30)
  const base = 'id, status, created_at, code_version_id, domain, url, target, vercel_deployment_id'
  let { data, error } = await query(`${base}, promoted_at`)
  if (error && isUnknownColumnError(error)) ({ data, error } = await query(base))
  if (error) throw new Error(`live deployment lookup failed: ${error.message}`)
  return productionRowsNewestFirst((data ?? []) as unknown as RolloutDeploymentRow[]).find((r) => r.status === 'ready') ?? null
}

/** Newest non-failed staged build of a code version, its state confirmed with Vercel when still open. */
async function loadStagedBuild(versionId: string): Promise<StagedRow | null> {
  const { data, error } = await supabaseAdmin
    .from('deployments')
    .select('id, vercel_project_id, vercel_deployment_id, status, url, scaffold_version, created_at')
    .eq('code_version_id', versionId)
    .eq('target', 'staged')
    .not('status', 'in', '(error,canceled)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const row = data as StagedRow
  if (row.status !== 'ready' && row.vercel_deployment_id) {
    try {
      const st = await getDeploymentStatus(row.vercel_deployment_id)
      if (st.state !== row.status) {
        await supabaseAdmin.from('deployments')
          .update({ status: st.state, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        row.status = st.state
      }
    } catch (err) {
      console.warn('[publish] staged build status lookup failed:', err)
    }
  }
  return row.status === 'error' || row.status === 'canceled' ? null : row
}

/** Is a production build (Push to Live, rollout, restore) of this project still running? */
async function productionBuildInProgress(projectId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('deployments')
    .select('id, vercel_deployment_id, status')
    .eq('project_id', projectId)
    .eq('target', 'production')
    .in('status', ['building', 'queued'])
    .gte('created_at', new Date(Date.now() - PRODUCTION_BUILD_FRESH_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(MAX_STATUS_LOOKUPS + 1)
  if (error) throw new Error(`production build lookup failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; vercel_deployment_id: string | null; status: string }>
  if (rows.length > MAX_STATUS_LOOKUPS) return true
  for (const r of rows) {
    if (!r.vercel_deployment_id) continue
    // DB rows only settle when someone polls — ask Vercel before blocking the owner.
    const st = await getDeploymentStatus(r.vercel_deployment_id)
    if (st.state === 'building' || st.state === 'queued') return true
    await supabaseAdmin.from('deployments')
      .update({ status: st.state, updated_at: new Date().toISOString() })
      .eq('id', r.id)
  }
  return false
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const [gate, ready, latest] = await Promise.all([
    getHostingGate(project.id),
    isDraftPublishReady(),
    loadLatestVersion(project.id),
  ])
  let live: RolloutDeploymentRow | null
  try {
    live = await loadLiveRow(project.id)
  } catch (err) {
    console.error('[publish] GET:', err)
    return NextResponse.json({ error: 'Could not load the publish state.' }, { status: 503 })
  }

  let liveVersionNo: number | null = null
  if (live?.code_version_id) {
    const { data } = await supabaseAdmin.from('code_versions').select('version_no')
      .eq('id', live.code_version_id).eq('project_id', project.id).maybeSingle()
    liveVersionNo = (data as { version_no?: number } | null)?.version_no ?? null
  }
  const staged = latest && ready ? await loadStagedBuild(latest.id) : null

  return NextResponse.json({
    draftPublishReady: ready,
    everLive: gate.everLive,
    canPublish: gate.everLive && gate.canDeployProduction,
    reason: gate.canDeployProduction ? undefined : gate.reason,
    live: live ? { versionId: live.code_version_id, versionNo: liveVersionNo, url: live.url } : null,
    latest: latest ? { versionId: latest.id, versionNo: latest.version_no, createdAt: latest.created_at, prompt: latest.prompt } : null,
    upToDate: !!latest && live?.code_version_id === latest.id,
    staged: staged
      ? { deploymentId: staged.vercel_deployment_id, status: staged.status, url: staged.url, current: (staged.scaffold_version ?? 1) >= SCAFFOLD_VERSION }
      : null,
  })
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const project = await getOwnedProject<{ id: string; name: string | null }>(id, userId, 'id, name')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Promote is free and builds nothing, but it still re-points live domains.
  if (!rateLimit(`publish:${userId}`, 20, 10 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many publishes. Please wait a few minutes.' }, { status: 429 })
  }

  const gate = await getHostingGate(project.id)
  if (!gate.everLive) {
    // The first go-live (trial claim, env setup, domain) is Push to Live's job.
    return NextResponse.json({ mode: 'rebuild', reason: 'first_publish' })
  }
  if (!gate.canDeployProduction) {
    if (gate.reason === 'lookup_failed') {
      return NextResponse.json({ error: 'Could not verify your hosting plan. Please try again.' }, { status: 503 })
    }
    return NextResponse.json(
      { error: 'Hosting for this store is paused. Subscribe to publish changes.', code: 'SUBSCRIPTION_REQUIRED' },
      { status: 402 },
    )
  }
  if (!(await isDraftPublishReady())) return NextResponse.json({ mode: 'rebuild', reason: 'migration_pending' })

  const latest = await loadLatestVersion(project.id)
  if (!latest) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })

  let live: RolloutDeploymentRow | null
  try {
    live = await loadLiveRow(project.id)
  } catch (err) {
    console.error('[publish] POST:', err)
    return NextResponse.json({ error: 'Could not publish right now. Please try again.' }, { status: 503 })
  }
  if (live?.code_version_id === latest.id) {
    return NextResponse.json({ mode: 'up_to_date', versionNo: latest.version_no })
  }

  const staged = await loadStagedBuild(latest.id)
  if (!staged || !staged.vercel_deployment_id || !staged.vercel_project_id) {
    return NextResponse.json({ mode: 'rebuild', reason: 'no_draft_build' })
  }
  if ((staged.scaffold_version ?? 1) < SCAFFOLD_VERSION) {
    return NextResponse.json({ mode: 'rebuild', reason: 'outdated_draft_build' })
  }
  if (staged.status !== 'ready') {
    return NextResponse.json(
      { error: 'The preview of your latest changes is still building. Publish once it is ready.', code: 'draft_building', deploymentId: staged.vercel_deployment_id },
      { status: 409 },
    )
  }

  // A production build finishing AFTER the promote would take the domains back (it
  // auto-assigns when READY) — never race one.
  try {
    if (await productionBuildInProgress(project.id)) {
      return NextResponse.json(
        { error: 'A store update is being deployed right now. Try publishing again in a minute.', code: 'production_build_in_progress' },
        { status: 409 },
      )
    }
  } catch (err) {
    console.error('[publish] production build check failed:', err)
    return NextResponse.json({ error: 'Could not publish right now. Please try again.' }, { status: 503 })
  }

  // Confirm with Vercel: READY and production target (a staged build).
  try {
    const st = await getDeploymentStatus(staged.vercel_deployment_id)
    if (st.state !== 'ready' || st.target !== 'production') {
      return NextResponse.json({ mode: 'rebuild', reason: 'draft_build_not_promotable' })
    }
  } catch (err) {
    console.error('[publish] staged build lookup failed:', err)
    return NextResponse.json({ error: 'Could not publish right now. Please try again.' }, { status: 503 })
  }

  let storeDomain: string | null = null
  try {
    storeDomain = `${await getOrClaimStoreSlug(project.id, project.name ?? '')}.${HOSTING_ROOT_DOMAIN}`
  } catch (err) {
    console.warn('[publish] store slug lookup failed (promoting anyway):', err)
  }

  try {
    await promoteDeployment(staged.vercel_project_id, staged.vercel_deployment_id)
  } catch (err) {
    console.error('[publish] promote failed:', err)
    // e.g. Vercel refuses to promote a build twice — a fresh production build still works.
    return NextResponse.json({ mode: 'rebuild', reason: 'promote_failed' })
  }

  const promotedAt = new Date().toISOString()
  const { error: updErr } = await supabaseAdmin
    .from('deployments')
    .update({
      target: 'production',
      promoted_at: promotedAt,
      ...(storeDomain ? { domain: storeDomain, url: `https://${storeDomain}` } : {}),
      updated_at: promotedAt,
    })
    .eq('id', staged.id)
    .eq('target', 'staged')
  if (updErr) {
    // The store IS live on this build — only the bookkeeping failed. Pricing / rollout
    // would keep reading the previous live version until the next publish.
    console.error('[publish] promoted, but the deployments row update failed:', updErr.message)
  }

  return NextResponse.json({
    mode: 'promoted',
    versionNo: latest.version_no,
    url: storeDomain ? `https://${storeDomain}` : live?.url ?? null,
  })
}
