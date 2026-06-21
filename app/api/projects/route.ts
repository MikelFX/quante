import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { name } = await request.json()

  // Enforce project limit server-side
  const record = await getUserRecord(userId)
  const { count: activeCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('status', 'archived')

  if ((activeCount ?? 0) >= record.project_limit) {
    const isAgency = record.tier === 'agency'
    return NextResponse.json(
      {
        error: isAgency
          ? `Agency plan limit reached (${record.project_limit} active projects). Contact support for a custom plan.`
          : `Project limit reached (${record.project_limit}). Upgrade to Agency for up to 20 projects.`,
        code: 'PROJECT_LIMIT_REACHED',
        limit: record.project_limit,
      },
      { status: 403 }
    )
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, name: name || 'Untitled store', status: 'draft' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
