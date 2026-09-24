import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'
import { parseManifestJson } from '@/lib/manifest-schema'
import { hasPaidAdminPanel } from '@/app/api/quante/admin-panel/paid'
import type { ShopManifest } from '@/types/manifest'

const MAX_PROMPT_CHARS = 500

// Direct manifest save — no AI, no credit deduction.
// Used by the Studio editor for product CRUD and section text edits.
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: unknown; manifest?: unknown; prompt?: unknown }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { projectId, manifest, prompt } = body

  if (!projectId || !manifest) {
    return NextResponse.json({ error: 'projectId and manifest required' }, { status: 400 })
  }

  // Ownership check (service-role client — RLS does not apply)
  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const parsed = parseManifestJson(JSON.stringify(manifest))
  if (!parsed) return NextResponse.json({ error: 'Invalid manifest.' }, { status: 422 })

  // adminPanel is a PAID add-on (/api/quante/admin-panel). Never take it from the
  // client — otherwise a free save + free export unlocks the admin panel. It is set
  // only when the purchase is recorded server-side.
  const parsedRecord = parsed as unknown as Record<string, unknown>
  delete parsedRecord.adminPanel
  if (await hasPaidAdminPanel(userId, project.id)) parsedRecord.adminPanel = true

  const { data: latest } = await supabaseAdmin
    .from('manifest_versions')
    .select('version_no')
    .eq('project_id', project.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version_no ?? 0) + 1

  const { data: saved, error: saveErr } = await supabaseAdmin
    .from('manifest_versions')
    .insert({
      project_id: project.id,
      version_no: nextVersion,
      manifest: parsedRecord,
      prompt: typeof prompt === 'string' && prompt.trim() ? prompt.slice(0, MAX_PROMPT_CHARS) : 'Direct edit',
    })
    .select('id')
    .single()

  if (saveErr || !saved) {
    console.error('[manifest/save]', saveErr)
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  return NextResponse.json({ manifest: parsed as ShopManifest, versionId: saved.id })
}
