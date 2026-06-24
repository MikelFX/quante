import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { attachDomain } from '@/lib/hosting/vercel'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain, projectId } = (await request.json()) as {
    domain?: string
    projectId?: string
  }

  if (!domain || !projectId) {
    return Response.json({ error: 'domain and projectId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()

  if (!project?.vercel_project_id) {
    return Response.json({ error: 'Project not found or not deployed' }, { status: 404 })
  }

  let dnsInstructions: string | undefined
  try {
    const result = await attachDomain(project.vercel_project_id, domain)
    dnsInstructions = result.dnsInstructions
  } catch (err) {
    console.error('[domains/connect]', err)
    return Response.json({ error: 'Failed to attach domain to Vercel' }, { status: 500 })
  }

  // Save to user_domains
  await supabaseAdmin.from('user_domains').upsert(
    {
      user_id: userId,
      project_id: projectId,
      domain,
      status: 'pending',
      vercel_project_id: project.vercel_project_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'domain' },
  )

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
