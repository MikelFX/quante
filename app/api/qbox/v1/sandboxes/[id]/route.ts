// Qbox API: GET /api/qbox/v1/sandboxes/{id} — state + preview URLs; DELETE — stop it now.

import { NextResponse } from 'next/server'
import { isLive, publicSandbox } from '@/lib/qbox/model'
import { apiError, authenticate, markEnded, ownSandbox } from '@/lib/qbox/store'
import { engine } from '@/lib/qbox/vercel'

export const maxDuration = 30

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { id } = await params
  const row = await ownSandbox(a.member.userId, id).catch(() => null)
  if (!row) return apiError(404, 'No such sandbox.')
  const now = Date.now()
  const previews: Record<string, string> = {}
  if (isLive(row, now)) {
    for (const p of row.ports ?? []) {
      const url = await engine().previewUrl(id, p).catch(() => null)
      if (url) previews[String(p)] = url
    }
  }
  return NextResponse.json(publicSandbox(row, now, previews))
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { id } = await params
  const row = await ownSandbox(a.member.userId, id).catch(() => null)
  if (!row) return apiError(404, 'No such sandbox.')
  try {
    await engine().kill(id)
  } catch (e) {
    console.error('[qbox] kill failed', e)
    return apiError(502, 'Could not stop the sandbox. Try again; it also stops by itself at expiresAt.')
  }
  await markEnded(id, 'stopped')
  return NextResponse.json({ id, status: 'stopped' })
}
