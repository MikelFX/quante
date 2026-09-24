import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { NextResponse } from 'next/server'

const MAX_NAME_LEN = 100

function limitResponse(tier: string, limit: number) {
  const isAgency = tier === 'agency'
  return NextResponse.json(
    {
      error: isAgency
        ? `Agency batch limit reached (${limit} simultaneous stores). Contact support for a custom plan.`
        : `Active store limit reached (${limit}). Upgrade to Agency to generate & export up to 20 stores at once.`,
      code: 'PROJECT_LIMIT_REACHED',
      limit,
    },
    { status: 403 }
  )
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const body = await request.json().catch(() => ({})) as { name?: unknown }
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, MAX_NAME_LEN)
    : 'Untitled store'

  // Enforce project limit server-side (fast pre-check)
  const record = await getUserRecord(userId)
  const { count: activeCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'archived')

  if ((activeCount ?? 0) >= record.project_limit) {
    return limitResponse(record.tier, record.project_limit)
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name, status: 'draft' })
    .select()
    .single()

  if (error || !project) {
    console.error('[projects POST] insert failed:', error?.message)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }

  // SECURITY: the count-then-insert above is racy — N parallel POSTs all pass the
  // pre-check. Re-check after inserting: rank the user's active projects oldest-first
  // and drop ours if it landed beyond the limit. Deterministic ordering means exactly
  // the overflow rows are removed even when several requests race.
  const { data: active, error: listErr } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  const rank = (active ?? []).findIndex((p) => p.id === project.id)
  if (listErr || rank === -1 || rank >= record.project_limit) {
    await supabase.from('projects').delete().eq('id', project.id).eq('user_id', userId)
    if (listErr) {
      console.error('[projects POST] limit re-check failed:', listErr.message)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }
    return limitResponse(record.tier, record.project_limit)
  }

  return NextResponse.json(project)
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(projects)
}
