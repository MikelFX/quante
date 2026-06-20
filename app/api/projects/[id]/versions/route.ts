import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Params { params: Promise<{ id: string }> }

export async function GET(_: Request, { params }: Params) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id').eq('id', id).eq('user_id', userId).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: versions, error } = await supabase
    .from('code_versions').select('id, version_no, prompt, created_at')
    .eq('project_id', id).order('version_no', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(versions ?? [])
}
