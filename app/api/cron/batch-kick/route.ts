// GET /api/cron/batch-kick — every minute (vercel.json, Pro plan). Safety net for Agency batch
// generation: starts queued stores of every unfinished batch (lib/generation/batch.ts kickBatch)
// in case a finished store's chain kick was lost. The stores it starts run in this invocation's
// after(), so it has the generation budget. Fails closed without CRON_SECRET (lib/cron-auth.ts).
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { kickBatch } from '@/lib/generation/batch'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('generation_jobs').select('batch_id, user_id')
    .eq('status', 'queued').not('batch_id', 'is', null)
    .limit(500)
  // Before supabase/migration-generation-batches.sql runs there is no batch_id — nothing to do.
  if (error) return NextResponse.json({ batches: 0, started: 0 })

  const batches = new Map<string, string>()
  for (const r of data ?? []) batches.set(r.batch_id as string, r.user_id as string)
  let started = 0
  for (const [batchId, userId] of batches) started += await kickBatch(batchId, userId)
  return NextResponse.json({ batches: batches.size, started })
}
