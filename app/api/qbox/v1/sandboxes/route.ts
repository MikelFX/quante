// Qbox API: POST /api/qbox/v1/sandboxes — start a sandbox; GET — list this month's.
// Auth: `Authorization: Bearer qbx_…` (keys from /qbox). Limits per tier: lib/qbox/model.ts.
// The work (row first, then the engine) lives in lib/qbox/actions.ts, shared with the MCP server.

import { NextResponse } from 'next/server'
import { authorize, createSandbox, listSandboxes, toResponse as reply } from '@/lib/qbox/actions'

export const maxDuration = 60

export async function POST(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await createSandbox(a, await request.json().catch(() => ({}))), a)
}

export async function GET(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await listSandboxes(a), a)
}
