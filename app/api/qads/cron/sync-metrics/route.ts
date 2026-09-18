// GET /api/qads/cron/sync-metrics — scheduled (see vercel.json), pulls the last 3 days
// of insights (today + 2 days back, to catch late-attributed conversions) for every
// live-deployed campaign, across every connected channel. Read-only against Meta/TikTok
// (getInsights only) — safe to run regardless of QADS_LIVE_DEPLOY.

import { NextResponse } from 'next/server'
import { syncAllCampaignMetrics } from '@/lib/qads/metrics/sync'

export const maxDuration = 120

function isoDateDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = request.headers.get('authorization') ?? ''
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const since = isoDateDaysAgo(2)
  const until = isoDateDaysAgo(0)

  const result = await syncAllCampaignMetrics(since, until)
  return NextResponse.json({ ok: true, since, until, ...result })
}
