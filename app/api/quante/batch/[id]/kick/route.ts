// POST /api/quante/batch/[id]/kick — internal. A finished batch job calls this (production only,
// lib/generation/batch.ts chainKick) so the next queued store starts in a fresh invocation with
// its own 300 s, with no page open. Authenticated with CRON_SECRET; fails closed without it.
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { isUuid } from '@/lib/auth/project'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { kickBatch } from '@/lib/generation/batch'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const { data } = await supabaseAdmin
    .from('generation_jobs').select('user_id').eq('batch_id', id).limit(1).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  const started = await kickBatch(id, data.user_id as string)
  return NextResponse.json({ started })
}
