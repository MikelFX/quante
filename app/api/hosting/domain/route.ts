import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { attachDomain, getDomainDnsConfigured } from '@/lib/hosting/vercel'
import { getOwnedProject } from '@/lib/auth/project'
// Custom-domain validation (audit #38) is shared with /api/domains/connect: platform
// zones (quantecode.com, *.<HOSTING_ROOT_DOMAIN>, the app host, Vercel's own zones,
// PLATFORM_DOMAINS), IP literals, single-label and reserved names are refused, and so is
// any name another user already holds (exact name: a proven or still-fresh claim;
// parent / child: only a proven claim).
import {
  checkForeignClaims,
  releaseStaleForeignClaims,
  validateCustomHostname,
} from '@/app/api/domains/_lib/hostname'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; domain?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { projectId, domain } = body
  if (!projectId || !domain) {
    return NextResponse.json({ error: 'projectId and domain required' }, { status: 400 })
  }

  const hostCheck = validateCustomHostname(domain)
  if (!hostCheck.ok) {
    return NextResponse.json(
      {
        error: hostCheck.reason === 'platform'
          ? 'This domain cannot be used as a custom domain.'
          : 'Invalid domain. Use format: example.com or shop.example.com',
      },
      { status: 400 },
    )
  }
  const domainClean = hostCheck.host

  const project = await getOwnedProject<{ id: string; vercel_project_id: string | null; custom_domain: string | null }>(
    projectId, userId, 'id, vercel_project_id, custom_domain',
  )
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.vercel_project_id) {
    return NextResponse.json({ error: 'Deploy your store first before adding a custom domain.' }, { status: 400 })
  }

  // One domain, one project: refuse hosts already on another of the caller's own
  // projects, and hosts another user holds (user_domains or projects.custom_domain) —
  // shared check with /api/domains/connect.
  const [otherProject, claims, disputed] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('id')
      .eq('custom_domain', domainClean)
      .eq('user_id', userId)
      .neq('id', project.id)
      .limit(1),
    checkForeignClaims(domainClean, userId),
    // A domain the caller bought through Quante whose payment is disputed (Stripe
    // webhook sets status 'disputed') must not be re-attached through this route either.
    supabaseAdmin
      .from('user_domains')
      .select('id')
      .eq('domain', domainClean)
      .eq('user_id', userId)
      .eq('status', 'disputed')
      .limit(1),
  ])
  if (disputed.error) {
    console.error('[hosting/domain] dispute check failed:', disputed.error)
    return NextResponse.json({ error: 'Failed to add domain to hosting.' }, { status: 500 })
  }
  if ((disputed.data?.length ?? 0) > 0) {
    return NextResponse.json({ error: 'This domain is locked because its payment is disputed. Contact support.' }, { status: 409 })
  }
  if (otherProject.error || !claims.ok) {
    console.error('[hosting/domain] uniqueness check failed:', otherProject.error ?? (claims.ok ? null : claims.error))
    return NextResponse.json({ error: 'Failed to add domain to hosting.' }, { status: 500 })
  }
  if ((otherProject.data?.length ?? 0) > 0 || claims.blocked) {
    return NextResponse.json({ error: 'This domain is already connected to another store.' }, { status: 409 })
  }

  // Another user's claim on this exact name that no longer holds it (never proven
  // within the unverified-claim window, or a dead user_domains row): detach + drop it
  // so the attach below (and the unique custom_domain index) can succeed.
  try {
    await releaseStaleForeignClaims(claims)
  } catch (err) {
    console.error('[hosting/domain] could not release stale claims on', domainClean, err)
    return NextResponse.json({ error: 'Failed to add domain to hosting.' }, { status: 500 })
  }

  let result: { verified: boolean; dnsInstructions?: string }
  try {
    // attachDomain only treats "already on THIS project" as success; a domain held by
    // another project in the team throws.
    result = await attachDomain(project.vercel_project_id, domainClean)
  } catch (err) {
    console.error('[hosting/domain] attachDomain failed:', err)
    if ((err as { statusCode?: number }).statusCode === 409) {
      return NextResponse.json({ error: 'This domain is already in use by another project.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to add domain to hosting.' }, { status: 500 })
  }

  // custom_domain_verified is PROOF of control: it makes this claim block other users
  // from the name's parents / children and keeps it past the unverified-claim window.
  // So it requires the public DNS to actually point at Vercel — Vercel's `verified`
  // flag alone is true for any domain no other Vercel account claims. Re-submitting the
  // domain re-checks it, and the daily hosting cron refreshes it.
  const verified = result.verified ? (await getDomainDnsConfigured(domainClean)) === true : false
  const domainChanged = project.custom_domain !== domainClean

  // Persist on project
  const { error: updErr } = await supabaseAdmin
    .from('projects')
    .update({ custom_domain: domainClean, custom_domain_verified: verified })
    .eq('id', project.id)
    .eq('user_id', userId)
  if (updErr) {
    console.error('[hosting/domain] failed to persist custom domain:', updErr)
    // 23505 = unique index (migration-security-deploy-hosting-cron.sql) lost a race.
    if ((updErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'This domain is already connected to another store.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to save domain.' }, { status: 500 })
  }

  // Start the unverified-claim clock only when the domain actually changed (so
  // re-submitting can't extend it). Separate, best-effort write: the column comes from
  // migration-security2-deploy-domains-misc.sql, and without it an unverified claim
  // simply never ages out (fail closed).
  if (domainChanged) {
    const { error: setAtErr } = await supabaseAdmin
      .from('projects')
      .update({ custom_domain_set_at: new Date().toISOString() })
      .eq('id', project.id)
      .eq('custom_domain', domainClean)
    if (setAtErr) console.warn('[hosting/domain] custom_domain_set_at not recorded (run migration-security2-deploy-domains-misc.sql?):', setAtErr.message)
  }

  // Also update the latest deployment row
  const { data: latestDeploy } = await supabaseAdmin
    .from('deployments')
    .select('id')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestDeploy) {
    await supabaseAdmin
      .from('deployments')
      .update({ custom_domain: domainClean, custom_domain_verified: verified })
      .eq('id', latestDeploy.id)
  }

  const dnsInstructions = result.dnsInstructions ?? (verified ? undefined : `Add CNAME: ${domainClean} → cname.vercel-dns.com`)
  return NextResponse.json({ verified, dnsInstructions, domain: domainClean })
}
