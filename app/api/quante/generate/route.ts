import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, GENERATION_MODEL, SYSTEM_PROMPT_GENERATION } from '@/lib/claude'
import { parseManifestJson } from '@/lib/manifest-schema'
import { jsonrepair } from 'jsonrepair'

export const maxDuration = 300

const GENERATE_COST = 10
const GENERATE_RATE_LIMIT = 5
const MAX_TOKENS = 50000

function makeStream(fn: (send: (event: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: object) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }
      try { await fn(send) } finally { controller.close() }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const { brief, projectName, projectId: existingProjectId } = await request.json()

    if (!brief?.trim()) { send({ type: 'error', message: 'Brief is required.' }); return }

    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const supabase = await createClient()

    const { data: ledger } = await supabase
      .from('credit_ledger').select('balance_after')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

    const balance = ledger?.balance_after ?? 0
    if (balance < GENERATE_COST) {
      send({ type: 'error', message: `Insufficient credits. Need ${GENERATE_COST}, have ${balance}.` })
      return
    }

    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await supabase
      .from('credit_ledger').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('reason', 'generate').gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= GENERATE_RATE_LIMIT) {
      send({ type: 'error', message: `Rate limit reached — max ${GENERATE_RATE_LIMIT} generations per hour.` })
      return
    }

    send({ type: 'status', text: 'Designing your store…' })

    let rawOutput = ''
    const claudeStream = anthropic.messages.stream({
      model: GENERATION_MODEL, max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_GENERATION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: brief.trim() }],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text
        send({ type: 'chunk', text: event.delta.text })
      }
    }

    send({ type: 'status', text: 'Validating manifest…' })

    let manifest
    try {
      manifest = parseManifestJson(rawOutput)
    } catch {
      // Fast repair via jsonrepair
      try {
        manifest = parseManifestJson(jsonrepair(rawOutput))
      } catch {
        send({ type: 'status', text: 'Repairing manifest…' })
        try {
          const repair = await anthropic.messages.create({
            model: GENERATION_MODEL, max_tokens: MAX_TOKENS,
            messages: [{ role: 'user', content: `Fix this invalid ShopManifest JSON and return ONLY the corrected JSON:\n${rawOutput.slice(0, 60000)}` }],
          })
          const repairText = repair.content[0].type === 'text' ? repair.content[0].text : ''
          manifest = parseManifestJson(jsonrepair(repairText))
        } catch {
          send({ type: 'error', message: 'Could not produce a valid manifest. Please try again with a more detailed brief.' })
          return
        }
      }
    }

    send({ type: 'status', text: 'Saving…' })

    let projectId = existingProjectId
    if (!projectId) {
      const { data: project, error: projError } = await supabase
        .from('projects').insert({ user_id: userId, name: projectName || manifest.brand.name, status: 'draft' })
        .select().single()
      if (projError || !project) { send({ type: 'error', message: 'Failed to create project.' }); return }
      projectId = project.id
    }

    const { data: version, error: versionError } = await supabase
      .from('manifest_versions').insert({ project_id: projectId, version_no: 1, manifest, prompt: brief })
      .select().single()

    if (versionError || !version) { send({ type: 'error', message: 'Failed to save manifest.' }); return }

    await supabase.from('credit_ledger').insert({
      user_id: userId, delta: -GENERATE_COST, reason: 'generate',
      ref_id: version.id, balance_after: balance - GENERATE_COST,
    })
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

    send({ type: 'done', projectId, versionId: version.id, manifest })
  })
}
