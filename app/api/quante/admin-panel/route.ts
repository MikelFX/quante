import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const maxDuration = 60

const ADMIN_COST = 5

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId } = await request.json()
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Balance check
  const { data: ledger } = await supabase
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const balance = ledger?.balance_after ?? 0
  if (balance < ADMIN_COST) {
    return NextResponse.json(
      { error: `Insufficient credits. Need ${ADMIN_COST}, have ${balance}.` },
      { status: 402 }
    )
  }

  // Get current manifest
  const { data: version } = await supabase
    .from('manifest_versions')
    .select('manifest, version_no')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return NextResponse.json({ error: 'No manifest found.' }, { status: 404 })

  // Patch manifest with adminPanel flag
  const updatedManifest = { ...(version.manifest as object), adminPanel: true }

  const { data: newVersion } = await supabase
    .from('manifest_versions')
    .insert({
      project_id: projectId,
      version_no: version.version_no + 1,
      manifest: updatedManifest,
      prompt: 'Admin panel added',
    })
    .select()
    .single()

  if (!newVersion) return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })

  // Debit credits
  await supabase.from('credit_ledger').insert({
    user_id: userId,
    delta: -ADMIN_COST,
    reason: 'admin_panel',
    ref_id: newVersion.id,
    balance_after: balance - ADMIN_COST,
  })

  return NextResponse.json({ ok: true, balance: balance - ADMIN_COST })
}
