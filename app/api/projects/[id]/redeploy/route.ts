import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildStoreFiles } from '@/lib/store-template/build'
import { ensureVercelProject, createPreviewDeployment } from '@/lib/hosting/vercel'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 120

interface Params { params: Promise<{ id: string }> }

// POST /api/projects/[id]/redeploy
// Re-deploys the current code version as a preview — free, no Claude call.
// Used by "Rebuild preview" button and after version restore.

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, vercel_project_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Load latest code version
  const { data: current } = await supabase
    .from('code_versions')
    .select('id, files, version_no')
    .eq('project_id', id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!current) return NextResponse.json({ error: 'No code version found.' }, { status: 404 })

  const codeFiles = current.files as CodeVersionFiles

  const slug = (project.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  let vercelProjectId: string
  try {
    const result = await ensureVercelProject(slug)
    vercelProjectId = result.vercelProjectId
    if (!project.vercel_project_id) {
      await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', id)
    }
  } catch (err) {
    console.error('[redeploy] ensureVercelProject failed:', err)
    return NextResponse.json({ error: 'Failed to provision hosting project.' }, { status: 500 })
  }

  const allFiles = buildStoreFiles(codeFiles)

  let deploymentId: string
  let previewUrl: string
  try {
    const result = await createPreviewDeployment(
      vercelProjectId,
      allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
      slug,
    )
    deploymentId = result.deploymentId
    previewUrl = result.url
  } catch (err) {
    console.error('[redeploy] createPreviewDeployment failed:', err)
    return NextResponse.json({ error: 'Deployment failed.' }, { status: 500 })
  }

  await supabaseAdmin.from('deployments').insert({
    project_id: id,
    user_id: userId,
    vercel_project_id: vercelProjectId,
    vercel_deployment_id: deploymentId,
    status: 'building',
    url: previewUrl.startsWith('https://') ? previewUrl : `https://${previewUrl}`,
    domain: null,
    version: current.version_no,
    code_version_id: current.id,
  })

  return NextResponse.json({ deploymentId, previewUrl })
}
