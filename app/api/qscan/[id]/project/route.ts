// POST /api/qscan/[id]/project { projectId } — records which store a scan built
// (qscan_scans.project_id), so Grideet shows the scan under that store. Called by /qscan once the
// "Build my new store" generation has finished. Both the scan and the project must belong to the
// signed-in user. Without supabase/migration-grideet.sql the column is missing: the call answers
// 503 and nothing else changes (Grideet then lists the scan as unassigned).
// A store without a brand kit gets a first one from the scan (the copied logo and product photos,
// the old site's tagline and description — lib/brand-kit kitFromScan); an existing kit is kept.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject, isUuid } from '@/lib/auth/project'
import { isEmptyKit, kitFromScan, type ScanSummaryLike } from '@/lib/brand-kit/model'
import { assetsBase, getBrandKit, saveBrandKit } from '@/lib/brand-kit/store'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { projectId?: unknown } | null
  if (!isUuid(id) || !isUuid(body?.projectId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const project = await getOwnedProject<{ id: string }>(body.projectId, userId, 'id')
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('qscan_scans')
    .update({ project_id: project.id })
    .eq('id', id).eq('user_id', userId)
    .select('id, summary')
    .maybeSingle()
  if (error) {
    const missing = error.code === '42703' || error.code === 'PGRST204' || /project_id/.test(error.message ?? '')
    if (missing) return NextResponse.json({ error: 'Grideet is not set up yet.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not save.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const current = await getBrandKit(project.id, userId)
  let seeded = false
  if (current.ready && !current.exists) {
    const kit = kitFromScan((data as { summary?: ScanSummaryLike | null }).summary, userId, assetsBase())
    if (!isEmptyKit(kit)) seeded = (await saveBrandKit(project.id, userId, kit)).ok
  }
  return NextResponse.json({ ok: true, brandKitSeeded: seeded })
}
