import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'

interface Params { params: Promise<{ id: string }> }

// Restore is free and the Studio follows it with a free /redeploy, so cap it per user
// (DB-backed, survives across serverless instances) to stop version/Vercel churn.
const RESTORE_WINDOW_MS = 60 * 60 * 1000
const MAX_RESTORES_PER_WINDOW = 20
const RESTORE_PROMPT_PREFIX = 'Restored from v'

// POST /api/projects/[id]/restore  { versionId }
// Copies an older code version forward as a new version. Code-gen stores only —
// the build (lib/store-template/build.ts) has no admin-panel files in this mode, so
// a restored version can never unlock the paid legacy admin add-on (audit #62).
export async function POST(request: Request, { params }: Params) {
  const { id } = await params

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { versionId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const versionId = body?.versionId
  if (!versionId) return NextResponse.json({ error: 'versionId required' }, { status: 400 })
  if (!isUuid(versionId)) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  // Ownership check (service-role client — RLS does not protect us here).
  const project = await getOwnedProject<{ id: string }>(id, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { count: recentRestores, error: countErr } = await supabaseAdmin
    .from('code_versions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .like('prompt', `${RESTORE_PROMPT_PREFIX}%`)
    .gte('created_at', new Date(Date.now() - RESTORE_WINDOW_MS).toISOString())
  if (countErr) {
    console.error('[restore] rate-limit lookup failed:', countErr.message)
    return NextResponse.json({ error: 'Could not restore right now. Please try again.' }, { status: 503 })
  }
  if ((recentRestores ?? 0) >= MAX_RESTORES_PER_WINDOW) {
    return NextResponse.json({ error: 'Too many restores. Please wait a while and try again.' }, { status: 429 })
  }

  // Only versions the owner wrote into this project.
  const { data: target } = await supabaseAdmin
    .from('code_versions')
    .select('files, version_no')
    .eq('id', versionId)
    .eq('project_id', project.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!target) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

  // Numbering spans every row of the project so the new version is always the latest.
  const { data: latest } = await supabaseAdmin
    .from('code_versions')
    .select('version_no')
    .eq('project_id', project.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: newVersion, error } = await supabaseAdmin
    .from('code_versions').insert({
      project_id: project.id,
      user_id: userId,
      version_no: (latest?.version_no ?? 0) + 1,
      files: target.files,
      prompt: `${RESTORE_PROMPT_PREFIX}${target.version_no}`,
    }).select().single()

  if (error || !newVersion) return NextResponse.json({ error: 'Failed to restore' }, { status: 500 })

  await supabaseAdmin
    .from('projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', project.id)
    .eq('user_id', userId)

  return NextResponse.json({ versionId: newVersion.id, files: target.files })
}
