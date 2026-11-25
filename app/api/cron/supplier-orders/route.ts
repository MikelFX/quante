// GET /api/cron/supplier-orders — every 10 minutes (vercel.json): the safety net behind the payment
// webhooks. Sends paid orders that still have unsent supplier lines and retries failed sends
// (lib/suppliers/dispatch.ts dispatchPending; exactly once per order × supplier by a UNIQUE row).
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { dispatchPending } from '@/lib/suppliers/dispatch'

export const maxDuration = 300

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await dispatchPending())
}
