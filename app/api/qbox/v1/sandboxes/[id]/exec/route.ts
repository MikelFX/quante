// Qbox API: POST /api/qbox/v1/sandboxes/{id}/exec — run a command and wait for it.
// Body: { cmd, args?, cwd?, env?, timeoutMs? } or { command: "npm test && ls" } (sh -c).

import { NextResponse } from 'next/server'
import { authorize, execIn, toResponse } from '@/lib/qbox/actions'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return toResponse(await execIn(a, (await params).id, await request.json().catch(() => null)), a)
}
