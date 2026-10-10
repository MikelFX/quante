// GET /api/quante/batch/[id] → { batchId, jobs } — the batch page polls this. Each poll also
// nudges the queue (lib/generation/batch.ts kickBatch), so an open page keeps the batch moving
// even where the production chain kick isn't available (previews, local dev).
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isUuid } from '@/lib/auth/project'
import { batchJobs, kickBatch } from '@/lib/generation/batch'

export const maxDuration = 300

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })

  let jobs = await batchJobs(id, userId)
  if (!jobs) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  if (jobs.some((j) => j.status === 'queued') && (await kickBatch(id, userId)) > 0) {
    jobs = (await batchJobs(id, userId)) ?? jobs
  }
  return NextResponse.json({ batchId: id, jobs })
}
