import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildStoreFiles, toStoreSlug } from '@/lib/store-template/build'
import { CREDIT_COSTS } from '@/lib/config'
import {
  ensureVercelProject,
  setEnvVars,
  createDeployment,
  createVercelPreviewDeploy,
  getDeploymentStatus,
  getBuildError,
  attachDomain,
  HOSTING_ROOT_DOMAIN,
} from '@/lib/hosting/vercel'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 60

const DEPLOY_COST = 5
const PREVIEW_DEPLOY_COST = CREDIT_COSTS.preview_deploy

// ─── POST /api/deploy ─────────────────────────────────────────────────────────
// Kick off a deployment. Returns immediately with { deploymentId, domain }.
// The client polls GET /api/deploy/status?id=<deploymentId> for updates.

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const body = await request.json()
  const { projectId, type = 'production' }: { projectId: string; type?: 'preview' | 'production' } = body
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // ── Preview deploy path (2 credits, unique Vercel URL, no subdomain) ──────────
  if (type === 'preview') {
    const supabase = await createClient()

    const { data: project } = await supabase
      .from('projects').select('id, name, vercel_project_id').eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { data: ledger } = await supabase
      .from('credit_ledger').select('balance_after').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const balance = ledger?.balance_after ?? 0
    if (balance < PREVIEW_DEPLOY_COST) {
      return NextResponse.json({ error: `Insufficient credits. Need ${PREVIEW_DEPLOY_COST}, have ${balance}.` }, { status: 402 })
    }

    const { data: version } = await supabase
      .from('code_versions').select('id, files, version_no').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!version) return NextResponse.json({ error: 'No generated store found.' }, { status: 404 })

    const slug = (() => {
      try {
        const cfg = (version.files as Record<string, string>)['data/config.ts'] ?? ''
        const m = cfg.match(/name:\s*['"]([^'"]+)['"]/)
        return m ? toStoreSlug(m[1]) : toStoreSlug(project.name)
      } catch { return toStoreSlug(project.name) }
    })() || 'my-store'

    let vercelProjectId: string
    try {
      const r = await ensureVercelProject(slug)
      vercelProjectId = r.vercelProjectId
      if (!project.vercel_project_id) {
        await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', projectId)
      }
    } catch (err) {
      console.error('[deploy/preview] ensureVercelProject failed:', err)
      return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
    }

    let files
    try { files = buildStoreFiles(version.files as Record<string, string>) }
    catch (err) { console.error('[deploy/preview] buildStoreFiles failed:', err); return NextResponse.json({ error: 'Failed to build store files.' }, { status: 500 }) }

    let deploymentId: string, previewUrl: string
    try {
      const r = await createVercelPreviewDeploy(
        vercelProjectId,
        files.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
      )
      deploymentId = r.deploymentId
      previewUrl = r.url
    } catch (err) {
      console.error('[deploy/preview] createVercelPreviewDeploy failed:', err)
      return NextResponse.json({ error: 'Failed to start preview deployment.' }, { status: 500 })
    }

    // Debit credits immediately for preview (no polling)
    await supabaseAdmin.from('credit_ledger').insert({
      user_id: userId, delta: -PREVIEW_DEPLOY_COST, reason: 'preview_deploy',
      ref_id: projectId, balance_after: balance - PREVIEW_DEPLOY_COST,
    })

    await supabaseAdmin.from('deployments').insert({
      project_id: projectId, user_id: userId,
      vercel_project_id: vercelProjectId, vercel_deployment_id: deploymentId,
      status: 'building', url: previewUrl, domain: null,
      version: version.version_no, code_version_id: version.id,
    })

    return NextResponse.json({ deploymentId, previewUrl, type: 'preview' })
  }

  // Load project (ownership check via RLS) — fetch trial column separately so a missing
  // migration column doesn't silently break the whole lookup
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id, name, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (projectErr) console.error('[deploy] project lookup error:', projectErr)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Load trial date separately (column added by migration-hosting-billing.sql)
  const { data: trialRow } = await supabase
    .from('projects')
    .select('hosting_trial_ends_at')
    .eq('id', projectId)
    .maybeSingle()
  const hostingTrialEndsAt: string | null = (trialRow as { hosting_trial_ends_at?: string | null } | null)?.hosting_trial_ends_at ?? null

  // Enforce trial / subscription gate on re-deploys
  if (hostingTrialEndsAt) {
    const trialActive = new Date(hostingTrialEndsAt) > new Date()
    if (!trialActive) {
      const { data: activeSub } = await supabase
        .from('hosting_subscriptions')
        .select('id')
        .eq('project_id', projectId)
        .in('status', ['active', 'trialing'])
        .maybeSingle()

      if (!activeSub) {
        return NextResponse.json(
          { error: 'Your 30-day free trial has ended. Subscribe to continue hosting.', code: 'SUBSCRIPTION_REQUIRED' },
          { status: 402 },
        )
      }
    }
  }

  // Credits check
  const { data: ledger } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = ledger?.balance_after ?? 0
  if (balance < DEPLOY_COST) {
    return NextResponse.json(
      { error: `Insufficient credits. Need ${DEPLOY_COST}, have ${balance}.` },
      { status: 402 },
    )
  }

  // Load latest code version
  const { data: version } = await supabase
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) {
    return NextResponse.json({ error: 'No generated store found. Generate a store first.' }, { status: 404 })
  }

  const codeFiles = version.files as CodeVersionFiles

  // Derive slug from config.ts if present, otherwise from project name
  let slug = 'my-store'
  try {
    const configFile = codeFiles['data/config.ts'] ?? ''
    const nameMatch = configFile.match(/name:\s*['"]([^'"]+)['"]/)
    if (nameMatch) slug = toStoreSlug(nameMatch[1])
    else slug = toStoreSlug(project.name) || 'my-store'
  } catch {
    slug = toStoreSlug(project.name) || 'my-store'
  }

  const intendedDomain = `${slug}.${HOSTING_ROOT_DOMAIN}`

  // Build file tree: scaffold + AI-generated code files merged on top
  let files
  try {
    files = buildStoreFiles(codeFiles)
  } catch (err) {
    console.error('[deploy] buildStoreFiles failed:', err)
    return NextResponse.json({ error: 'Failed to build store files.' }, { status: 500 })
  }

  // Ensure Vercel project exists
  let vercelProjectId: string
  try {
    const result = await ensureVercelProject(slug)
    vercelProjectId = result.vercelProjectId

    // Persist the Vercel project ID if it's new
    if (!project.vercel_project_id) {
      await supabaseAdmin
        .from('projects')
        .update({ vercel_project_id: vercelProjectId })
        .eq('id', projectId)
    }
  } catch (err) {
    console.error('[deploy] ensureVercelProject failed:', err)
    return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
  }

  // Generate / retrieve per-project API key for store → Quante communication
  const { data: existingSecrets } = await supabaseAdmin
    .from('project_secrets')
    .select('quante_api_key')
    .eq('project_id', projectId)
    .maybeSingle()

  const quanteApiKey = (existingSecrets as { quante_api_key?: string | null } | null)?.quante_api_key
    ?? crypto.randomUUID()

  await supabaseAdmin.from('project_secrets').upsert({
    project_id: projectId,
    user_id: userId,
    quante_api_key: quanteApiKey,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id', ignoreDuplicates: false })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'

  // Managed payments — store calls back to Quante, no Stripe keys in deployed store
  const envVars: Record<string, string> = {
    QUANTE_API_URL: appUrl,
    QUANTE_PROJECT_ID: projectId,
    QUANTE_API_KEY: quanteApiKey,
  }

  try {
    await setEnvVars(vercelProjectId, envVars, { encrypted: ['QUANTE_API_KEY'] })
  } catch (err) {
    console.warn('[deploy] setEnvVars failed (non-fatal):', err)
  }

  // Create the Vercel deployment
  let deploymentId: string
  let vercelUrl: string
  try {
    const result = await createDeployment(vercelProjectId, files, { target: 'production' })
    deploymentId = result.deploymentId
    vercelUrl = result.url
  } catch (err) {
    console.error('[deploy] createDeployment failed:', err)
    return NextResponse.json({ error: 'Failed to start deployment.' }, { status: 500 })
  }

  // Persist deployment row
  const { data: deployRow, error: insertErr } = await supabaseAdmin
    .from('deployments')
    .insert({
      project_id: projectId,
      user_id: userId,
      vercel_project_id: vercelProjectId,
      vercel_deployment_id: deploymentId,
      status: 'building',
      url: vercelUrl.startsWith('https://') ? vercelUrl : `https://${vercelUrl}`,
      domain: intendedDomain,
      version: version.version_no,
      code_version_id: version.id,
    })
    .select('id')
    .single()

  if (insertErr || !deployRow) {
    console.error('[deploy] failed to insert deployment row:', insertErr)
    // Deployment is still running on Vercel — log but don't abort
  }

  return NextResponse.json({
    deploymentId,
    dbId: deployRow?.id ?? null,
    domain: intendedDomain,
    status: 'building',
  })
}

// ─── GET /api/deploy/status?id=<deploymentId> ─────────────────────────────────
// Check the current state of a deployment. Transitions building→ready/error,
// attaches the domain, and debits credits exactly once.

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const deploymentId = searchParams.get('id')
  if (!deploymentId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()

  // Load deployment row (RLS: user can only see their own)
  const { data: row } = await supabase
    .from('deployments')
    .select('id, project_id, vercel_project_id, vercel_deployment_id, status, url, domain, error_message, version, version_id')
    .eq('user_id', userId)
    .eq('vercel_deployment_id', deploymentId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })

  // Already settled — return cached state
  if (row.status === 'ready' || row.status === 'error' || row.status === 'canceled') {
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

    return NextResponse.json({ status: vercelStatus.state, errorMessage })
  }

  if (vercelStatus.state === 'ready') {
    const domain = row.domain as string | null
    let finalUrl = vercelStatus.url ?? row.url

    // Only attach domain for production deploys (preview deploys have domain = null)
    if (domain) {
      try {
        const domainResult = await attachDomain(row.vercel_project_id as string, domain)
        if (domainResult.verified) {
          finalUrl = `https://${domain}`
        }
      } catch (err) {
        // Domain already attached or wildcard DNS handles it — log and continue
        console.warn('[deploy/status] attachDomain non-fatal:', err)
        finalUrl = `https://${domain}`
      }
    }

    // Update deployment row
    await supabaseAdmin
      .from('deployments')
      .update({ status: 'ready', url: finalUrl, updated_at: new Date().toISOString() })
      .eq('id', row.id)

    // Start 30-day trial on the project if this is the first successful deploy
    await supabaseAdmin
      .from('projects')
      .update({ hosting_trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq('id', row.project_id)
      .is('hosting_trial_ends_at', null)

    // Debit credits (after row update — user only charged on confirmed success)
    const { data: ledger } = await supabaseAdmin
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const balance = ledger?.balance_after ?? 0
    if (balance >= DEPLOY_COST) {
      await supabaseAdmin.from('credit_ledger').insert({
        user_id: userId,
        delta: -DEPLOY_COST,
        reason: 'deploy',
        ref_id: row.id,
        balance_after: balance - DEPLOY_COST,
      })
    }

    return NextResponse.json({ status: 'ready', url: finalUrl, domain })
  }

  return NextResponse.json({ status: row.status })
}
