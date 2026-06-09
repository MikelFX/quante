import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { attachDomain } from '@/lib/hosting/vercel'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, domain } = await request.json()
  if (!projectId || !domain) {
    return NextResponse.json({ error: 'projectId and domain required' }, { status: 400 })
  }

  const domainClean = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
  const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/
  if (!domainRegex.test(domainClean)) {
    return NextResponse.json({ error: 'Invalid domain. Use format: example.com or shop.example.com' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id, vercel_project_id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.vercel_project_id) {
    return NextResponse.json({ error: 'Deploy your store first before adding a custom domain.' }, { status: 400 })
  }

  let result: { verified: boolean; dnsInstructions?: string }
  try {
    result = await attachDomain(project.vercel_project_id as string, domainClean)
  } catch (err) {
    console.error('[hosting/domain] attachDomain failed:', err)
    return NextResponse.json({ error: 'Failed to add domain to hosting.' }, { status: 500 })
  }

  // Persist on project
  await supabaseAdmin
    .from('projects')
    .update({ custom_domain: domainClean, custom_domain_verified: result.verified })
    .eq('id', projectId)

  // Also update the latest deployment row
  const { data: latestDeploy } = await supabaseAdmin
    .from('deployments')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestDeploy) {
    await supabaseAdmin
      .from('deployments')
      .update({ custom_domain: domainClean, custom_domain_verified: result.verified })
      .eq('id', latestDeploy.id)
  }

  return NextResponse.json({ verified: result.verified, dnsInstructions: result.dnsInstructions, domain: domainClean })
}
