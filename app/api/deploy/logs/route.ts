import { auth } from '@clerk/nextjs/server'
import { streamDeploymentLogs, getBuildError, getDeploymentStatus } from '@/lib/hosting/vercel'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

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

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const abortController = new AbortController()

      // If client disconnects, abort polling
      request.signal?.addEventListener('abort', () => abortController.abort())

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
              void (async () => {
                try {
                  await supabaseAdmin.from('deployments')
                    .update({ status: event.type === 'ready' ? 'ready' : 'error' })
                    .eq('vercel_deployment_id', deploymentId)
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
                controller.close()
              })()
            }
          },
          abortController.signal,
        )
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error('[deploy/logs] streaming error:', err)
          sendEvent({ type: 'stream_error', message: String(err) })
        }
        controller.close()
      }
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
