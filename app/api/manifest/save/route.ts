import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseManifestJson } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

// Direct manifest save — no AI, no credit deduction.
// Used by the Studio editor for product CRUD and section text edits.
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { projectId, manifest, prompt } = await request.json()

  if (!projectId || !manifest) {
    return NextResponse.json({ error: 'projectId and manifest required' }, { status: 400 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const parsed = parseManifestJson(JSON.stringify(manifest))
  if (!parsed) return NextResponse.json({ error: 'Invalid manifest.' }, { status: 422 })

  const { data: latest } = await supabase
    .from('manifest_versions')
    .select('version_no')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version_no ?? 0) + 1

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('manifest_versions')
    .insert({
      project_id: projectId,
      version_no: nextVersion,
      manifest: parsed as unknown as Record<string, unknown>,
      prompt: prompt ?? 'Direct edit',
    })
    .select('id')
    .single()

  if (saveErr || !saved) {
    console.error('[manifest/save]', saveErr)
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  return NextResponse.json({ manifest: parsed as ShopManifest, versionId: saved.id })
}
