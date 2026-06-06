import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Params { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const { id } = await params
  const { versionId } = await request.json()
  if (!versionId) return NextResponse.json({ error: 'versionId required' }, { status: 400 })

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id').eq('id', id).eq('user_id', userId).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: target } = await supabase
    .from('manifest_versions').select('manifest, version_no').eq('id', versionId).eq('project_id', id).single()
  if (!target) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  const { data: latest } = await supabase
    .from('manifest_versions').select('version_no').eq('project_id', id).order('version_no', { ascending: false }).limit(1).single()

  const { data: newVersion, error } = await supabase
    .from('manifest_versions').insert({
      project_id: id, version_no: (latest?.version_no ?? 0) + 1,
      manifest: target.manifest, prompt: `Restored from v${target.version_no}`,
    }).select().single()

  if (error || !newVersion) return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })

  await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id)

  return NextResponse.json({ versionId: newVersion.id, manifest: target.manifest })
}
