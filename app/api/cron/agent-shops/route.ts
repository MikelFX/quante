// GET /api/cron/agent-shops — daily Vercel cron (vercel.json): re-reads every store in the agent-ready
// registry (lib/agent-shops/registry.ts refreshShop): fresh products and stock, or one more failure
// (after UNREACHABLE_AFTER failures in a row the store drops out of search until it answers again).
// Fails closed without CRON_SECRET (lib/cron-auth.ts).
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { refreshShop, shopsToRefresh } from '@/lib/agent-shops/registry'

export const maxDuration = 300

const BATCH = 200
const CONCURRENCY = 5

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const shops = await shopsToRefresh(BATCH)
  const results: Array<Awaited<ReturnType<typeof refreshShop>>> = []
  for (let i = 0; i < shops.length; i += CONCURRENCY) {
    const part = await Promise.all(shops.slice(i, i + CONCURRENCY).map((s) => refreshShop(s).catch((e) => ({ origin: s.origin, ok: false, error: e instanceof Error ? e.message : 'failed' }))))
    results.push(...part)
  }
  return NextResponse.json({ checked: results.length, ok: results.filter((r) => r.ok).length, results })
}
