import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const projectId = formData.get('projectId') as string | null

  if (!file || !projectId) {
    return NextResponse.json({ error: 'file and projectId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('store-assets')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadErr) {
    console.error('[upload]', uploadErr)
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
  }

  const { data: urlData } = supabaseAdmin.storage.from('store-assets').getPublicUrl(path)
  return NextResponse.json({ url: urlData.publicUrl })
}
