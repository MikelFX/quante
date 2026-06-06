import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_ITERATION } from '@/lib/claude'
import { parseManifestJson } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

export const maxDuration = 300

const ITERATE_COST = 1
const ITERATE_RATE_LIMIT = 30
const MAX_TOKENS = 50000

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
    const { projectId, instruction } = await request.json()
    if (!projectId || !instruction?.trim()) {
      send({ type: 'error', message: 'projectId and instruction are required.' }); return
    }

    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const supabase = await createClient()

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (!project) { send({ type: 'error', message: 'Project not found.' }); return }

    const { data: ledger } = await supabase
      .from('credit_ledger').select('balance_after')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

    const balance = ledger?.balance_after ?? 0
    if (balance < ITERATE_COST) {
      send({ type: 'error', message: `Insufficient credits. Need ${ITERATE_COST}, have ${balance}.` }); return
    }

    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await supabase
      .from('credit_ledger').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('reason', 'iterate').gte('created_at', oneHourAgo)
    if ((recentCount ?? 0) >= ITERATE_RATE_LIMIT) {
      send({ type: 'error', message: `Rate limit reached — max ${ITERATE_RATE_LIMIT} iterations per hour.` }); return
    }

    const { data: current } = await supabase
      .from('manifest_versions').select('manifest, version_no')
      .eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).maybeSingle()
    if (!current) { send({ type: 'error', message: 'No manifest found for this project.' }); return }

    send({ type: 'status', text: 'Updating your store…' })

    let rawOutput = ''
    const claudeStream = anthropic.messages.stream({
      model: ITERATION_MODEL, max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_ITERATION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Current manifest:\n${JSON.stringify(current.manifest, null, 2)}\n\nInstruction: ${instruction.trim()}` }],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text
        send({ type: 'chunk', text: event.delta.text })
      }
    }

    send({ type: 'status', text: 'Validating…' })

    let manifest: ShopManifest
    try {
      manifest = parseManifestJson(rawOutput) as ShopManifest
    } catch {
      send({ type: 'status', text: 'Repairing manifest…' })
      try {
        const repair = await anthropic.messages.create({
          model: ITERATION_MODEL, max_tokens: MAX_TOKENS,
          messages: [{
            role: 'user',
            content: `Fix this invalid ShopManifest JSON and return ONLY the corrected JSON. Keep ALL original content — only fix syntax/schema errors:\n${rawOutput}`,
          }],
        })
        const repairText = repair.content[0].type === 'text' ? repair.content[0].text : ''
        manifest = parseManifestJson(repairText) as ShopManifest
      } catch {
        send({ type: 'error', message: 'Could not apply that change. Try breaking it into smaller steps.' }); return
      }
    }

    const { data: version, error: versionError } = await supabase
      .from('manifest_versions').insert({ project_id: projectId, version_no: current.version_no + 1, manifest, prompt: instruction })
      .select().single()
    if (versionError || !version) { send({ type: 'error', message: 'Failed to save updated manifest.' }); return }

    await Promise.all([
      supabase.from('credit_ledger').insert({
        user_id: userId, delta: -ITERATE_COST, reason: 'iterate', ref_id: version.id, balance_after: balance - ITERATE_COST,
      }),
      supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId),
    ])

    send({ type: 'done', projectId, versionId: version.id, manifest })
  })
}
