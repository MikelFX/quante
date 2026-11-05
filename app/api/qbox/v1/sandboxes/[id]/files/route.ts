// Qbox API: files in a sandbox.
//   PUT /api/qbox/v1/sandboxes/{id}/files?path=src/app.js   body = the raw file bytes
//   GET /api/qbox/v1/sandboxes/{id}/files?path=out/report.txt → the raw bytes
// Relative paths are inside the working directory (/vercel/sandbox). Max QBOX_BETA.maxFileBytes.

import { NextResponse } from 'next/server'
import { QBOX_BETA } from '@/lib/qbox/model'
import { apiError } from '@/lib/qbox/store'
import { authorize, readFileIn, toResponse, writeFileIn } from '@/lib/qbox/actions'

export const maxDuration = 60

const pathOf = (request: Request) => new URL(request.url).searchParams.get('path')

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  if (Number(request.headers.get('content-length') ?? '0') > QBOX_BETA.maxFileBytes) {
    return apiError(413, `Files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB.`)
  }
  const body = new Uint8Array(await request.arrayBuffer())
  return toResponse(await writeFileIn(a, (await params).id, pathOf(request), body), a)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  const r = await readFileIn(a, (await params).id, pathOf(request))
  if (!r.ok) return toResponse(r, a)
  return new NextResponse(new Uint8Array(r.data.content), {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
