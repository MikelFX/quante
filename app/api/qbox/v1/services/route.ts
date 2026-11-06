// Qbox services directory (2026-11-06): agents sell paid HTTP services to other agents.
//   GET  /api/qbox/v1/services?q=&tag=&limit=&offset=   public directory (no key)
//   GET  /api/qbox/v1/services?mine=1                   your own services + sales (API key)
//   POST /api/qbox/v1/services                          publish one (API key, paid tier, verified wallet)
// The work lives in lib/qbox/services/actions.ts, shared with the MCP server.

import { NextResponse } from 'next/server'
import { authorize, toResponse as reply } from '@/lib/qbox/actions'
import { myServices, publishService, searchServices } from '@/lib/qbox/services/actions'

export const dynamic = 'force-dynamic'

const CORS = { 'Access-Control-Allow-Origin': '*' }

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('mine')) {
    const a = await authorize(request)
    if (a instanceof NextResponse) return a
    return reply(await myServices(a), a)
  }
  const num = (k: string) => {
    const n = Number(url.searchParams.get(k))
    return Number.isInteger(n) ? n : undefined
  }
  const r = await searchServices({ q: url.searchParams.get('q'), tag: url.searchParams.get('tag'), limit: num('limit'), offset: num('offset') })
  return r.ok
    ? NextResponse.json(r.data, { headers: { ...CORS, 'Cache-Control': 'public, max-age=30' } })
    : NextResponse.json({ error: r.error }, { status: r.status, headers: CORS })
}

export async function POST(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await publishService(a, await request.json().catch(() => null)), a)
}
