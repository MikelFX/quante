// PATCH /api/qads/generations/[id]/share  { share: boolean } — the owner shares a generation's
// finished photos and videos on the community wall, or takes them down (lib/qads/community.ts).
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUuid } from '@/lib/auth/project'
import { isMissingCommunityColumn } from '@/lib/qads/community'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { share?: unknown } | null
  if (typeof body?.share !== 'boolean') return NextResponse.json({ error: 'share must be true or false' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('qads_generations')
    .update({ share_community: body.share })
    .eq('id', id).eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) {
    if (isMissingCommunityColumn(error)) return NextResponse.json({ error: 'The community library is not set up yet.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not update sharing.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, share: body.share })
}
