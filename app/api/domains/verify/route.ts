import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const domain = url.searchParams.get('domain')
  if (!domain) return Response.json({ error: 'domain required' }, { status: 400 })

  const supabase = await createClient()
  const { data: domainRow } = await supabase
    .from('user_domains')
    .select('id, vercel_project_id, status')
    .eq('domain', domain)
    .eq('user_id', userId)
    .maybeSingle()

  if (!domainRow?.vercel_project_id) {
    return Response.json({ verified: false, reason: 'Domain not found' })
  }

  // Call Vercel API to check domain verification status
  try {
    const teamId = process.env.VERCEL_TEAM_ID ?? ''
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    }
    if (teamId) headers['x-vercel-team-id'] = teamId

    const res = await fetch(
      `https://api.vercel.com/v9/projects/${domainRow.vercel_project_id}/domains/${domain}`,
      { headers },
    )
    const data = (await res.json()) as {
      verified?: boolean
      verification?: unknown[]
    }
    const verified = data.verified === true

    if (verified && domainRow.status !== 'active') {
      await supabaseAdmin
        .from('user_domains')
        .update({
          status: 'active',
          dns_verified: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', domainRow.id)
    }

    return Response.json({ verified, verificationDetails: data.verification ?? [] })
  } catch {
    return Response.json({ verified: false, reason: 'Could not check verification' })
  }
}
