import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildStoreFiles, toStoreSlug } from '@/lib/store-template/build'
import {
  ensureVercelProject,
  setEnvVars,
  createDeployment,
  getDeploymentStatus,
  attachDomain,
  HOSTING_ROOT_DOMAIN,
} from '@/lib/hosting/vercel'
import type { ShopManifest } from '@/types/manifest'

export const maxDuration = 60

const DEPLOY_COST = 15

// ─── POST /api/deploy ─────────────────────────────────────────────────────────
// Kick off a deployment. Returns immediately with { deploymentId, domain }.
// The client polls GET /api/deploy/status?id=<deploymentId> for updates.

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

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

  // Load latest manifest
  const { data: version } = await supabase
    .from('manifest_versions')
    .select('id, manifest, version_no')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) {
    return NextResponse.json({ error: 'No manifest found. Generate a store first.' }, { status: 404 })
  }

  const rawManifest = version.manifest as ShopManifest
  // Always include admin panel in deployed stores
  const manifest: ShopManifest = { ...rawManifest, adminPanel: true } as ShopManifest
  const slug = toStoreSlug(manifest.brand.name) || 'my-store'
  const intendedDomain = `${slug}.${HOSTING_ROOT_DOMAIN}`

  // Build file tree (reuses the same source as export ZIP)
  let files
  try {
    files = buildStoreFiles(manifest)
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

  // Generate a per-project notification token and store it
  const notificationToken = crypto.randomUUID()
  await supabaseAdmin.from('project_secrets').upsert({
    project_id: projectId,
    user_id: userId,
    notification_token: notificationToken,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id', ignoreDuplicates: false })

  // Set placeholder Stripe keys + notification callback env vars
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quante.vercel.app'
  try {
    await setEnvVars(
      vercelProjectId,
      {
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_replace_me',
        STRIPE_SECRET_KEY: 'sk_live_replace_me',
        STRIPE_WEBHOOK_SECRET: 'whsec_replace_me',
        QUANTE_NOTIFY_URL: `${appUrl}/api/notify/order`,
        QUANTE_NOTIFY_SECRET: notificationToken,
      },
      { encrypted: ['STRIPE_SECRET_KEY', 'QUANTE_NOTIFY_SECRET'] },
    )
  } catch (err) {
    // Non-fatal — deployment can proceed without these; user adds Stripe keys later
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
      version_id: version.id,
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
    return NextResponse.json({
      status: row.status,
      url: row.url,
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
    await supabaseAdmin
      .from('deployments')
      .update({ status: vercelStatus.state, error_message: 'Build failed on Vercel.', updated_at: new Date().toISOString() })
      .eq('id', row.id)

    return NextResponse.json({ status: vercelStatus.state, errorMessage: 'Build failed on Vercel.' })
  }

  if (vercelStatus.state === 'ready') {
    const domain = row.domain as string
    let finalUrl = vercelStatus.url ?? row.url

    // Attach the subdomain (idempotent — if already attached, Vercel returns 400 which we ignore)
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
