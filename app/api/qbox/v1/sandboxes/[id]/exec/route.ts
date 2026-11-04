// Qbox API: POST /api/qbox/v1/sandboxes/{id}/exec — run a command and wait for it.
// Body: { cmd, args?, cwd?, env?, timeoutMs? } or { command: "npm test && ls" } (sh -c).

import { NextResponse } from 'next/server'
import { QboxInputError, clipOutput, isLive, parseExec } from '@/lib/qbox/model'
import { apiError, authenticate, markEnded, ownSandbox } from '@/lib/qbox/store'
import { engine } from '@/lib/qbox/vercel'
import { SandboxGoneError } from '@/lib/qbox/provider'

export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authenticate(request)
  if (a instanceof NextResponse) return a
  const { id } = await params
  const row = await ownSandbox(a.member.userId, id).catch(() => null)
  if (!row) return apiError(404, 'No such sandbox.')
  if (!isLive(row, Date.now())) return apiError(409, 'The sandbox has stopped. Start a new one.')

  let input
  try {
    input = parseExec(await request.json().catch(() => null))
  } catch (e) {
    return apiError(400, e instanceof QboxInputError ? e.message : 'Invalid request body.')
  }
  // Never wait past the sandbox's own end.
  input.timeoutMs = Math.max(1000, Math.min(input.timeoutMs, Date.parse(row.expires_at) - Date.now()))

  const started = Date.now()
  try {
    const r = await engine().exec(id, input)
    const out = clipOutput(r.stdout)
    const err = clipOutput(r.stderr)
    return NextResponse.json({
      exitCode: r.exitCode, stdout: out.text, stderr: err.text,
      truncated: out.truncated || err.truncated, timedOut: r.timedOut, durationMs: Date.now() - started,
    })
  } catch (e) {
    if (e instanceof SandboxGoneError) {
      await markEnded(id, 'stopped')
      return apiError(409, 'The sandbox has stopped. Start a new one.')
    }
    console.error('[qbox] exec failed', e)
    return apiError(502, 'The command could not be run. Try again.')
  }
}
