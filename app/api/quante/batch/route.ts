// POST /api/quante/batch  { items: [{ brief, name? }] }  → 202 { batchId }
//   Agency batch generation: up to AGENCY_BATCH_SIZE stores, AGENCY_BATCH_CONCURRENCY at a time
//   (lib/generation/batch.ts). Agency only; no credits, daily fair-use cap.
// GET  /api/quante/batch → { batches } — the user's batches from the last day (dashboard banner).
//   Also nudges every unfinished batch, so an open dashboard keeps the queue moving.
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { isAgencyUser } from '@/lib/tier'
import { createBatch, kickBatch, parseBatchItems, recentBatches } from '@/lib/generation/batch'

// The stores a request starts run in its after(): same budget as a single generation.
export const maxDuration = 300

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!(await isAgencyUser(userId))) {
    return NextResponse.json({ error: 'Batch generation is part of the Agency plan.', code: 'agency_required' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { items?: unknown } | null
  const parsed = parseBatchItems(body?.items)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  const res = await createBatch(userId, parsed.items)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ batchId: res.batchId }, { status: 202 })
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const batches = await recentBatches(userId)
  for (const b of batches) if (b.queued > 0) await kickBatch(b.batchId, userId)
  return NextResponse.json({ batches })
}
