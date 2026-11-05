// GET /api/cron/indexnow — weekly Vercel cron (vercel.json): submits every public page and agent
// file of both hosts to IndexNow (lib/agents/indexnow.ts). Off without INDEXNOW_KEY; fails closed
// without CRON_SECRET (lib/cron-auth.ts).
import { NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { INDEXNOW_ENDPOINT, indexNowKey, indexNowPayloads } from '@/lib/agents/indexnow'

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = indexNowKey(process.env)
  if (!key) return NextResponse.json({ skipped: 'INDEXNOW_KEY is not set' })
  const results = []
  for (const p of indexNowPayloads(key)) {
    const r = await fetch(INDEXNOW_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(p) })
      .then((res) => res.status).catch(() => 0)
    results.push({ host: p.host, urls: p.urlList.length, status: r })
  }
  return NextResponse.json({ results })
}
