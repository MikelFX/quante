import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeHostname } from '@/lib/namecheap'
import { getDomainDnsConfigured } from '@/lib/hosting/vercel'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const rawDomain = url.searchParams.get('domain')
  if (!rawDomain) return Response.json({ error: 'domain required' }, { status: 400 })
  const domain = normalizeHostname(rawDomain)
  if (!domain) return Response.json({ verified: false, reason: 'Domain not found' })

  // Only the caller's own row (service-role client — ownership is enforced here).
  const { data: domainRow } = await supabaseAdmin
    .from('user_domains')
    .select('id, domain, vercel_project_id, status')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domainRow?.vercel_project_id) {
    return Response.json({ verified: false, reason: 'Domain not found' })
  }

  const token = process.env.VERCEL_TOKEN
  if (!token) {
    console.error('[domains/verify] VERCEL_TOKEN not configured')
    return Response.json({ verified: false, reason: 'Could not check verification' })
  }

  // Call Vercel API to check domain verification status
  try {
    // Every interpolated value is URL-encoded (path segments and the team query).
    const qs = new URLSearchParams()
    if (process.env.VERCEL_TEAM_ID) qs.set('teamId', process.env.VERCEL_TEAM_ID)
    const query = qs.toString()

    const res = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(String(domainRow.vercel_project_id))}/domains/${encodeURIComponent(String(domainRow.domain))}${query ? `?${query}` : ''}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return Response.json({ verified: false, reason: 'Could not check verification' })
    const data = (await res.json()) as {
      name?: string
      projectId?: string
      verified?: boolean
      verification?: unknown[]
    }
    // Only trust an answer that is about THIS domain on THIS project.
    const sameDomain = !data.name || data.name.toLowerCase() === domain
    const sameProject = !data.projectId || data.projectId === domainRow.vercel_project_id
    const verified = data.verified === true && sameDomain && sameProject

    // dns_verified is proof of control (it makes this row block other users from the
    // name's parents / children — see domains/_lib/hostname.ts), so it tracks whether
    // the public DNS really points at Vercel, not Vercel's ownership flag alone.
    const dnsConfigured = verified ? (await getDomainDnsConfigured(domain)) === true : false

    // Only promote pending rows / refresh live ones — never resurrect
    // expired/failed/refunded ones.
    if (verified && (domainRow.status === 'pending' || domainRow.status === 'active')) {
      await supabaseAdmin
        .from('user_domains')
        .update({
          status: 'active',
          dns_verified: dnsConfigured,
          updated_at: new Date().toISOString(),
        })
        .eq('id', domainRow.id)
        .eq('user_id', userId)
        .eq('status', domainRow.status)
    }

    return Response.json({ verified, dnsConfigured, verificationDetails: data.verification ?? [] })
  } catch {
    return Response.json({ verified: false, reason: 'Could not check verification' })
  }
}
