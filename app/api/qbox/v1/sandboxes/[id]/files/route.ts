// Qbox API: files in a sandbox.
//   PUT /api/qbox/v1/sandboxes/{id}/files?path=src/app.js   body = the raw file bytes
//   GET /api/qbox/v1/sandboxes/{id}/files?path=out/report.txt → the raw bytes
// Relative paths are inside the working directory (/vercel/sandbox). Max QBOX_BETA.maxFileBytes.

import { NextResponse } from 'next/server'
import { QBOX_BETA, QboxInputError, isLive, sandboxPath } from '@/lib/qbox/model'
import { apiError, authenticate, markEnded, ownSandbox } from '@/lib/qbox/store'
import { engine } from '@/lib/qbox/vercel'
import { SandboxGoneError } from '@/lib/qbox/provider'

export const maxDuration = 60

async function open(request: Request, params: Promise<{ id: string }>) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { id } = await params
  const row = await ownSandbox(a.member.userId, id).catch(() => null)
  if (!row) return apiError(404, 'No such sandbox.')
  if (!isLive(row, Date.now())) return apiError(409, 'The sandbox has stopped. Start a new one.')
  let path: string
  try {
    path = sandboxPath(new URL(request.url).searchParams.get('path'))
  } catch (e) {
    return apiError(400, e instanceof QboxInputError ? e.message : 'Invalid path.')
  }
  return { id, path }
}

async function gone(id: string, e: unknown) {
  if (e instanceof SandboxGoneError) {
    await markEnded(id, 'stopped')
    return apiError(409, 'The sandbox has stopped. Start a new one.')
  }
  console.error('[qbox] file op failed', e)
  return apiError(502, 'The file operation failed. Try again.')
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(request, params)
  if (o instanceof NextResponse) return o
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > QBOX_BETA.maxFileBytes) return apiError(413, `Files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB in the beta.`)
  const body = new Uint8Array(await request.arrayBuffer())
  if (body.byteLength > QBOX_BETA.maxFileBytes) return apiError(413, `Files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB in the beta.`)
  try {
    await engine().writeFile(o.id, o.path, body)
    return NextResponse.json({ path: o.path, bytes: body.byteLength })
  } catch (e) {
    return gone(o.id, e)
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(request, params)
  if (o instanceof NextResponse) return o
  try {
    const buf = await engine().readFile(o.id, o.path)
    if (!buf) return apiError(404, 'No such file.')
    if (buf.byteLength > QBOX_BETA.maxFileBytes) return apiError(413, `Files up to ${QBOX_BETA.maxFileBytes / 1024 / 1024} MB in the beta.`)
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (e) {
    return gone(o.id, e)
  }
}
