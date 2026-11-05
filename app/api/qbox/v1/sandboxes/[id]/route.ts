// Qbox API: GET /api/qbox/v1/sandboxes/{id} — state + preview URLs; DELETE — stop it now.

import { NextResponse } from 'next/server'
import { authorize, getSandbox, stopSandbox, toResponse } from '@/lib/qbox/actions'

export const maxDuration = 30

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return toResponse(await getSandbox(a, (await params).id), a)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return toResponse(await stopSandbox(a, (await params).id), a)
}
