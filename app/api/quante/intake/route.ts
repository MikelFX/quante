import { auth } from '@clerk/nextjs/server'
import { anthropic, INTAKE_MODEL, SYSTEM_PROMPT_INTAKE } from '@/lib/claude'

export const maxDuration = 60

function makeStream(fn: (send: (event: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: object) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      try { await fn(send) } finally { controller.close() }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } })
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const { history } = await request.json()
    if (!Array.isArray(history) || history.length === 0) {
      send({ type: 'error', message: 'History is required.' }); return
    }

    // Anthropic requires messages to start with 'user' and alternate roles.
    // The client sends history starting from the first user message (opening is hardcoded client-side).
    const messages = history
      .filter((m: { role: string; content: string }) => m.content?.trim())
      .slice(-12) // keep last 12 turns for context

    if (messages.length === 0 || messages[0]?.role !== 'user') {
      send({ type: 'error', message: 'Invalid history.' }); return
    }

    let rawOutput = ''
    let sentVisible = 0

    const claudeStream = anthropic.messages.stream({
      model: INTAKE_MODEL,
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM_PROMPT_INTAKE, cache_control: { type: 'ephemeral' } }],
      messages,
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text

        // Stream only the visible part — stop before <ready> tag
        const readyStart = rawOutput.indexOf('<ready>')
        const visible = readyStart === -1 ? rawOutput : rawOutput.slice(0, readyStart)

        if (visible.length > sentVisible) {
          send({ type: 'text_chunk', text: visible.slice(sentVisible) })
          sentVisible = visible.length
        }
      }
    }

    const readyMatch = rawOutput.match(/<ready>([\s\S]*?)<\/ready>/)
    if (readyMatch) {
      send({ type: 'ready', brief: readyMatch[1].trim() })
    }
  })
}
