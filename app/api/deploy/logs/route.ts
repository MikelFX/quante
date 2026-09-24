import { auth } from '@clerk/nextjs/server'
import { streamDeploymentLogs, getBuildError, getDeploymentStatus } from '@/lib/hosting/vercel'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOwnedProject } from '@/lib/auth/project'

export const runtime = 'nodejs'
export const maxDuration = 300

// Vercel deployment ids look like dpl_<base62>. Anything else (hostnames, paths) is
// rejected before it can reach a Vercel API URL.
const DEPLOYMENT_ID_RE = /^dpl_[A-Za-z0-9]+$/

// Best-effort, per-instance cap on concurrently open log streams per user — each one
// can hold a function open for up to maxDuration.
const MAX_STREAMS_PER_USER = 3
const openStreams = new Map<string, number>()

function acquireStreamSlot(userId: string): boolean {
  const n = openStreams.get(userId) ?? 0
  if (n >= MAX_STREAMS_PER_USER) return false
  openStreams.set(userId, n + 1)
  return true
}

function releaseStreamSlot(userId: string): void {
  const n = (openStreams.get(userId) ?? 1) - 1
  if (n <= 0) openStreams.delete(userId)
  else openStreams.set(userId, n)
}

// ─── Vercel build error parser ────────────────────────────────────────────────
// Extracts file path and line from TypeScript/Next.js build errors like:
//   Type error: Property 'x' does not exist on type 'Y'.
//   ./components/store/Hero.tsx:42:7
interface ParsedError {
  filePath: string
  line: number
  message: string
}

function parseBuildError(text: string): ParsedError | null {
  // Match Next.js/TypeScript error format: (./)?path/to/file.tsx:line:col
  const fileLineMatch = text.match(/(?:\.\/)?([^:>\n\s'"]+\.(?:ts|tsx|js|jsx)):(\d+)(?::\d+)?/)
  if (!fileLineMatch) return null

  const filePath = fileLineMatch[1]
  const line = parseInt(fileLineMatch[2], 10)

  // Extract the error type/message (usually the line before the file path)
  const lines = text.split('\n').filter(Boolean)
  const fileLineIdx = lines.findIndex((l) => l.includes(fileLineMatch[0]))
  const message = fileLineIdx > 0 ? lines[fileLineIdx - 1].trim() : text.slice(0, 200)

  return { filePath, line, message }
}

// ─── GET /api/deploy/logs?deploymentId=<id> ───────────────────────────────────
// Server-Sent Events endpoint that streams Vercel build logs in real time.
// Each event: data: {"type":"stdout","text":"...","created":1234}\n\n

export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(request.url)
  const deploymentId = searchParams.get('deploymentId')
  if (!deploymentId) return new Response('deploymentId required', { status: 400 })
  if (!DEPLOYMENT_ID_RE.test(deploymentId)) return new Response('Not found', { status: 404 })

  // SECURITY (audit #34): the team-wide VERCEL_TOKEN can read ANY deployment's build
  // logs (other tenants', the platform's own). The caller must own a deployments row
  // for this id AND the project it belongs to. All later status writes are scoped to
  // that exact row.
  const { data: dep } = await supabaseAdmin
    .from('deployments')
    .select('id, project_id')
    .eq('vercel_deployment_id', deploymentId)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (!dep) return new Response('Not found', { status: 404 })
  const ownedProject = await getOwnedProject(dep.project_id, userId, 'id')
  if (!ownedProject) return new Response('Not found', { status: 404 })
  const deploymentRowId = dep.id as string

  if (!acquireStreamSlot(userId)) {
    return new Response('Too many open log streams', { status: 429 })
  }
  let slotReleased = false
  const releaseSlot = () => {
    if (slotReleased) return
    slotReleased = true
    releaseStreamSlot(userId)
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    cancel() {
      releaseSlot()
    },
    async start(controller) {
      let closed = false
      function sendEvent(data: object) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      function closeStream() {
        releaseSlot()
        if (closed) return
        closed = true
        try { controller.close() } catch {}
      }

      const abortController = new AbortController()

      // If client disconnects, abort polling
      request.signal?.addEventListener('abort', () => {
        abortController.abort()
        releaseSlot()
      })

      let terminalEventEmitted = false

      // Safety valve: if Vercel's events API hangs without sending a terminal event
      // (common for errored builds), abort after 90s so the client falls back to polling.
      const hangTimeout = setTimeout(() => {
        if (!terminalEventEmitted) {
          console.warn('[deploy/logs] Vercel events stream hung (90s, no terminal event) — aborting')
          abortController.abort()
        }
      }, 90_000)

      try {
        await streamDeploymentLogs(
          deploymentId,
          (event) => {
            sendEvent(event)

            // Detect build errors in log text and send a parsed error event
            if (event.type === 'stderr' || event.type === 'stdout') {
              const parsed = parseBuildError(event.text)
              if (parsed) {
                sendEvent({ type: 'build_error', ...parsed })
              }
            }

            // Signal end of stream on terminal states
            if (event.type === 'ready' || event.type === 'error') {
              terminalEventEmitted = true
              void (async () => {
                try {
                  await supabaseAdmin.from('deployments')
                    .update({ status: event.type === 'ready' ? 'ready' : 'error', updated_at: new Date().toISOString() })
                    .eq('id', deploymentRowId)
                } catch {}

                // On error: fetch full build error text and send as build_error event
                // so the client can surface it and trigger auto-fix even if log lines were missed
                if (event.type === 'error') {
                  try {
                    const errorText = await getBuildError(deploymentId)
                    if (errorText && !errorText.startsWith('Build failed — ')) {
                      const parsed = parseBuildError(errorText)
                      sendEvent({
                        type: 'build_error',
                        filePath: parsed?.filePath ?? 'store',
                        line: parsed?.line ?? 0,
                        message: errorText.slice(0, 800),
                      })
                    }
                  } catch {}
                }

                sendEvent({ type: 'stream_end', state: event.type })
                closeStream()
              })()
            }
          },
          abortController.signal,
        )
      } catch (err) {
        clearTimeout(hangTimeout)
        if (!abortController.signal.aborted) {
          console.error('[deploy/logs] streaming error:', err)
          // Generic message — never forward internal error details to the client.
          sendEvent({ type: 'stream_error', message: 'Log stream interrupted.' })
        }

        if (!terminalEventEmitted) {
          const MAX_POLLS = 30
          const POLL_INTERVAL = 10_000
          let resolved = false
          let consecutive404s = 0

          for (let i = 0; i < MAX_POLLS; i++) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL))
            // Client went away — stop burning function time on a stream nobody reads.
            if (request.signal?.aborted || closed) { resolved = true; break }

            let status
            try {
              status = await getDeploymentStatus(deploymentId)
            } catch (pollErr) {
              // Root cause of the eternal "Building…" bug (2026-08-18): without this
              // try/catch, a 404 from Vercel (deployment record never actually created,
              // or purged) would bubble out of start(), leaving the SSE stream neither
              // closed nor terminated. The client saw silence forever. Now we tolerate
              // a couple of 404s (Vercel is briefly eventually-consistent right after
              // createDeployment), then surface an explicit error to the client and
              // close the stream cleanly so the retry UI can appear.
              const msg = String((pollErr as { message?: unknown })?.message ?? pollErr)
              const is404 = msg.includes('404') || msg.toLowerCase().includes('not found')
              if (is404) consecutive404s += 1
              console.warn(`[deploy/logs] getDeploymentStatus poll failed (attempt ${i + 1}/${MAX_POLLS}, 404s=${consecutive404s}):`, msg)

              if (is404 && consecutive404s >= 3) {
                sendEvent({
                  type: 'build_error',
                  filePath: 'store',
                  line: 0,
                  message: 'Vercel never registered this deployment. This usually means the file upload was rejected upstream. Try redeploying.',
                })
                sendEvent({ type: 'stream_end', state: 'error' })
                terminalEventEmitted = true
                resolved = true
                break
              }
              continue
            }

            if (status.state === 'ready') {
              sendEvent({ type: 'stream_end', state: 'ready' })
              terminalEventEmitted = true
              resolved = true
              break
            }

            if (status.state === 'error') {
              let errorText = 'Build failed — check Vercel dashboard for details.'
              try { errorText = await getBuildError(deploymentId) } catch (buildErr) {
                console.warn('[deploy/logs] getBuildError failed:', buildErr)
              }
              sendEvent({ type: 'build_error', message: errorText })
              sendEvent({ type: 'stream_end', state: 'error' })
              terminalEventEmitted = true
              resolved = true
              break
            }
          }

          if (!resolved) {
            sendEvent({ type: 'stream_error', message: 'Build timed out after 5 minutes.' })
            sendEvent({ type: 'stream_end', state: 'error' })
            terminalEventEmitted = true
          }
        }

        closeStream()
        return
      }

      clearTimeout(hangTimeout)

      // Vercel's event stream closed without emitting a readyState event — this
      // happens when the build was already complete before we started streaming,
      // or when the 90s hang timeout fired and aborted the stream.
      // Check actual deployment state and resolve the client.
      if (!terminalEventEmitted && !request.signal?.aborted) {
        try {
          const status = await getDeploymentStatus(deploymentId)
          if (status.state === 'ready') {
            await supabaseAdmin.from('deployments')
              .update({ status: 'ready', updated_at: new Date().toISOString() })
              .eq('id', deploymentRowId)
            sendEvent({ type: 'ready', text: '', created: Date.now() })
            sendEvent({ type: 'stream_end', state: 'ready' })
          } else if (status.state === 'error' || status.state === 'canceled') {
            const errorText = await getBuildError(deploymentId)
            await supabaseAdmin.from('deployments')
              .update({ status: status.state, error_message: errorText, updated_at: new Date().toISOString() })
              .eq('id', deploymentRowId)
            if (errorText && !errorText.startsWith('Build failed — ')) {
              const parsed = parseBuildError(errorText)
              sendEvent({
                type: 'build_error',
                filePath: parsed?.filePath ?? 'store',
                line: parsed?.line ?? 0,
                message: errorText.slice(0, 800),
              })
            }
            sendEvent({ type: 'stream_end', state: 'error' })
          }
          // For 'building'/'queued': close without stream_end — client onerror fires and polls
        } catch (err) {
          console.error('[deploy/logs] post-stream status check failed:', err)
        }
        closeStream()
      } else if (!terminalEventEmitted) {
        // Client disconnected before a terminal event — nothing left to do.
        closeStream()
      }
      // When a terminal event WAS emitted, the async handler above closes the stream
      // (and releases the slot) once it has sent stream_end.
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
