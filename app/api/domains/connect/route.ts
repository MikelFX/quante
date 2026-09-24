import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { attachDomain, getDomainDnsConfigured } from '@/lib/hosting/vercel'
import { parseRegistrableDomain, isDomainRegistered } from '@/lib/namecheap'
import { getOwnedProject } from '@/lib/auth/project'
import { rateLimit } from '@/lib/rate-limit'
import { checkForeignClaims, releaseStaleForeignClaims, validateCustomHostname } from '../_lib/hostname'

// Matches /api/domains/purchase: an open checkout holds the name for its buyer.
const CHECKOUT_HOLD_MS = (31 + 5) * 60 * 1000

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = rateLimit(`domains-connect:${userId}`, 20, 3_600_000)
  if (!rl.allowed) {
    return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as {
    domain?: unknown
    projectId?: unknown
  } | null

  if (!body?.domain || !body.projectId) {
    return Response.json({ error: 'domain and projectId required' }, { status: 400 })
  }

  // Shared validator (audit #38) — same rules as /api/hosting/domain.
  const hostCheck = validateCustomHostname(body.domain)
  if (!hostCheck.ok) {
    return Response.json(
      {
        error: hostCheck.reason === 'platform'
          ? 'This domain cannot be connected.'
          : 'Invalid domain. Use format: example.com or shop.example.com',
      },
      { status: 400 },
    )
  }
  const domain = hostCheck.host

  const project = await getOwnedProject<{ id: string; vercel_project_id: string | null }>(
    body.projectId,
    userId,
    'id, vercel_project_id',
  )
  if (!project?.vercel_project_id) {
    return Response.json({ error: 'Project not found or not deployed' }, { status: 404 })
  }
  const projectId = project.id
  const vercelProjectId = project.vercel_project_id

  // SECURITY: user_domains is written with the service-role client, so
  // ownership is enforced here. A domain held by another user — the name
  // itself, any parent (www.<their-domain>) or any child (<their-sub>.<name>),
  // whether as a user_domains row or as a project's custom_domain set through
  // /api/hosting/domain — must never be attached to this caller's project or
  // have its row taken over.
  const claims = await checkForeignClaims(domain, userId)
  if (!claims.ok) {
    console.error('[domains/connect] ownership lookup failed:', claims.error)
    return Response.json({ error: 'Could not connect domain. Please try again.' }, { status: 500 })
  }
  // Parents / children only block when another user PROVES them (DNS-verified or
  // bought through Quante); the exact name also while an unproven claim is still
  // fresh (UNVERIFIED_CLAIM_TTL_MS). See _lib/hostname.ts.
  if (claims.blocked) {
    return Response.json({ error: 'This domain is already connected to another account.' }, { status: 409 })
  }
  const heldRows = claims.heldRows

  // Refuse names that don't exist at the registry yet (or are mid-checkout on
  // Quante): connecting an unregistered name would only squat it and block the
  // person who then buys it. Only checkable for the TLDs we sell; a Namecheap
  // outage fails open here because /api/domains/purchase releases such rows.
  const labels = domain.split('.')
  const apex = parseRegistrableDomain(labels.slice(-2).join('.'))
  if (apex) {
    const holdCutoff = new Date(Date.now() - CHECKOUT_HOLD_MS).toISOString()
    const { data: inFlight, error: inFlightError } = await supabaseAdmin
      .from('pending_domain_purchases')
      .select('id')
      .eq('domain', apex)
      .in('status', ['pending', 'processing'])
      .neq('user_id', userId)
      .gte('created_at', holdCutoff)
      .limit(1)
    if (inFlightError) {
      console.error('[domains/connect] pending lookup failed:', inFlightError.message)
      return Response.json({ error: 'Could not connect domain. Please try again.' }, { status: 500 })
    }
    if ((inFlight ?? []).length > 0) {
      return Response.json({ error: 'This domain is currently being purchased by someone else.' }, { status: 409 })
    }
    try {
      if (!(await isDomainRegistered(apex))) {
        return Response.json(
          { error: `${apex} isn't registered yet. Buy it first, then connect it.` },
          { status: 400 },
        )
      }
    } catch (err) {
      console.error('[domains/connect] registry check failed for', apex, err)
    }
  }

  // Another user's claim on this exact name that no longer holds it (expired / failed,
  // or never proven within UNVERIFIED_CLAIM_TTL_MS), as a user_domains row or a
  // projects.custom_domain: detach and drop it, so the unique `domain` column and
  // Vercel's one-project-per-domain rule don't block the claim below.
  try {
    await releaseStaleForeignClaims(claims)
  } catch (err) {
    console.error('[domains/connect] could not release stale claims on', domain, err)
    return Response.json({ error: 'Could not connect domain. Please try again.' }, { status: 500 })
  }
  const ownRow = heldRows.find((r) => r.domain === domain && r.user_id === userId) ?? null
  // The Stripe webhook owns a row while it registers the name (it deletes it by
  // status='registering' on failure) — don't flip it underneath.
  // Payment dispute on the purchase (Stripe webhook marks it) — can't be re-attached.
  if (ownRow?.status === 'disputed') {
    return Response.json({ error: 'This domain is locked because its payment is disputed. Contact support.' }, { status: 409 })
  }
  if (ownRow?.status === 'registering') {
    return Response.json({ error: 'This domain is still being registered. Please try again in a few minutes.' }, { status: 409 })
  }

  // Claim the row BEFORE touching Vercel, so a concurrent request for the
  // same domain loses on the unique constraint instead of both attaching.
  let claimedRowId: string | null = null
  if (!ownRow) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('user_domains')
      .insert({
        user_id: userId,
        project_id: projectId,
        domain,
        status: 'pending',
        vercel_project_id: vercelProjectId,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insertError || !inserted) {
      if (insertError?.code === '23505') {
        return Response.json({ error: 'This domain is already connected to another account.' }, { status: 409 })
      }
      console.error('[domains/connect] insert failed:', insertError?.message)
      return Response.json({ error: 'Could not connect domain. Please try again.' }, { status: 500 })
    }
    claimedRowId = inserted.id
  }

  let dnsInstructions: string | undefined
  let verified = false
  try {
    const result = await attachDomain(vercelProjectId, domain)
    dnsInstructions = result.dnsInstructions
    verified = result.verified
  } catch (err) {
    console.error('[domains/connect]', err)
    // Release the claim we just made; never touch a pre-existing row.
    if (claimedRowId) {
      await supabaseAdmin.from('user_domains').delete().eq('id', claimedRowId).eq('user_id', userId)
    }
    return Response.json({ error: 'Failed to attach domain to Vercel' }, { status: 500 })
  }

  // dns_verified is PROOF of control (it lets this row block other users from the
  // name's parents / children), so it needs the zone's public DNS to actually point at
  // Vercel. Vercel's `verified` flag alone is true for any domain no other Vercel
  // account claims.
  const dnsConfigured = verified ? (await getDomainDnsConfigured(domain)) === true : false

  // Update only the caller's own row — never an upsert on `domain`, which
  // used to overwrite (and re-own) another user's row.
  const { error: updateError } = await supabaseAdmin
    .from('user_domains')
    .update({
      project_id: projectId,
      status: verified ? 'active' : 'pending',
      dns_verified: dnsConfigured,
      vercel_project_id: vercelProjectId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', claimedRowId ?? ownRow!.id)
    .eq('user_id', userId)
  if (updateError) {
    console.error('[domains/connect] update failed:', updateError.message)
  }

  const cname = 'cname.vercel-dns.com'
  const defaultInstructions = [
    `Point your domain to Vercel by adding a CNAME record:`,
    `Type: CNAME`,
    `Name: @ (or subdomain)`,
    `Value: ${cname}`,
    ``,
    `Verification can take up to 48 hours.`,
  ].join('\n')

  return Response.json({
    domain,
    dnsType: 'CNAME',
    dnsName: '@',
    dnsValue: cname,
    instructions: dnsInstructions ?? defaultInstructions,
  })
}
