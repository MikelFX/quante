import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_ITERATION } from '@/lib/claude'
import { parseManifestJson } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'
import { jsonrepair } from 'jsonrepair'

export const maxDuration = 300

const ITERATE_COST = 1
const ITERATE_RATE_LIMIT = 60
const MAX_TOKENS = 64000

interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

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
    const body = await request.json()
    const projectId: string = body.projectId
    const instruction: string = body.instruction?.trim() ?? ''
    const history: HistoryMessage[] = body.history ?? []

    if (!projectId || !instruction) {
      send({ type: 'error', message: 'projectId and instruction are required.' }); return
    }

    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const supabase = await createClient()

    const { data: project } = await supabase
      .from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (!project) { send({ type: 'error', message: 'Project not found.' }); return }

    // Rate limit — count only paid iterations
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await supabase
      .from('credit_ledger').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('reason', 'iterate').gte('created_at', oneHourAgo)
    if ((recentCount ?? 0) >= ITERATE_RATE_LIMIT) {
      send({ type: 'error', message: `Rate limit reached — max ${ITERATE_RATE_LIMIT} store updates per hour.` }); return
    }

    const { data: current } = await supabase
      .from('manifest_versions').select('manifest, version_no')
      .eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).maybeSingle()
    if (!current) { send({ type: 'error', message: 'No manifest found for this project.' }); return }

    // System prompt with current manifest (prompt-cached)
    const systemWithManifest = `${SYSTEM_PROMPT_ITERATION}

═══ CURRENT STORE MANIFEST ═════════════════════════════════════════════════════
${JSON.stringify(current.manifest)}
════════════════════════════════════════════════════════════════════════════════`

    // Build conversation: last 8 history messages + current instruction
    const historyMessages = history
      .filter((m) => m.content && m.content !== '…')
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    const conversationMessages: { role: 'user' | 'assistant'; content: string }[] = [
      ...historyMessages,
      { role: 'user', content: instruction },
    ]

    // Stream Claude's response, sending the <reply> portion in real time
    let rawOutput = ''
    let replyDone = false
    let sentReplyLength = 0

    const claudeStream = anthropic.messages.stream({
      model: ITERATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: systemWithManifest, cache_control: { type: 'ephemeral' } }],
      messages: conversationMessages,
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text

        if (!replyDone) {
          const replyStart = rawOutput.indexOf('<reply>')
          const replyEndIdx = rawOutput.indexOf('</reply>')
          if (replyEndIdx !== -1) replyDone = true

          if (replyStart !== -1) {
            const contentStart = replyStart + '<reply>'.length
            const contentEnd = replyDone ? replyEndIdx : rawOutput.length
            const replyContent = rawOutput.slice(contentStart, contentEnd)
            if (replyContent.length > sentReplyLength) {
              send({ type: 'text_chunk', text: replyContent.slice(sentReplyLength) })
              sentReplyLength = replyContent.length
            }
          }
        }
      }
    }

    // Extract reply and optional patch
    const replyMatch = rawOutput.match(/<reply>([\s\S]*?)<\/reply>/)
    const replyText = replyMatch?.[1]?.trim() ?? rawOutput.trim()

    // Try closed tag first; fall back to truncated output (missing </patch>)
    const patchMatch = rawOutput.match(/<patch>([\s\S]*?)<\/patch>/)
    const patchStart = rawOutput.indexOf('<patch>')
    const rawPatchStr = patchMatch?.[1] ??
      (patchStart !== -1 ? rawOutput.slice(patchStart + '<patch>'.length).trim() : null)

    // No patch → free Q&A, no credit debit
    if (!rawPatchStr) {
      send({ type: 'done', reply: replyText, manifest: null })
      return
    }

    // Has patch → check credits, parse patch, merge with current manifest, validate
    const { data: ledger } = await supabase
      .from('credit_ledger').select('balance_after')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const balance = ledger?.balance_after ?? 0
    if (balance < ITERATE_COST) {
      send({ type: 'error', message: `Insufficient credits. Need ${ITERATE_COST}, have ${balance}.` }); return
    }

    // Parse the patch (partial manifest) and merge with current
    function parsePatch(raw: string): Record<string, unknown> {
      let cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
      const first = cleaned.indexOf('{')
      const last = cleaned.lastIndexOf('}')
      if (first > 0 && last > first) cleaned = cleaned.slice(first, last + 1)
      return JSON.parse(cleaned)
    }

    let manifest: ShopManifest
    try {
      const patch = parsePatch(rawPatchStr)
      const merged = { ...current.manifest as object, ...patch }
      manifest = parseManifestJson(JSON.stringify(merged)) as ShopManifest
    } catch (primaryErr) {
      // Fast repair: fix JSON syntax then re-merge
      try {
        const patch = parsePatch(jsonrepair(rawPatchStr))
        const merged = { ...current.manifest as object, ...patch }
        manifest = parseManifestJson(JSON.stringify(merged)) as ShopManifest
      } catch {
        // Slow repair: ask AI to fix the merged manifest
        console.error('[iterate] patch parse/merge failed, attempting AI repair:', primaryErr)
        send({ type: 'status', text: 'Repairing manifest…' })
        try {
          let errSummary: string
          if (primaryErr instanceof Error && primaryErr.name === 'ZodError') {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const zErr = primaryErr as any
              const flat = zErr.flatten?.()
              errSummary = flat
                ? `Zod validation failed:\n${JSON.stringify(flat, null, 2).slice(0, 1500)}`
                : String(primaryErr).slice(0, 1500)
            } catch {
              errSummary = String(primaryErr).slice(0, 1500)
            }
          } else {
            errSummary = String(primaryErr).slice(0, 1500)
          }

          // Merge what we can and send the merged JSON for repair
          let bestMerge: string
          try {
            const patch = parsePatch(jsonrepair(rawPatchStr))
            bestMerge = JSON.stringify({ ...current.manifest as object, ...patch })
          } catch {
            bestMerge = JSON.stringify(current.manifest)
          }

          const repair = await anthropic.messages.create({
            model: ITERATION_MODEL, max_tokens: MAX_TOKENS,
            messages: [{
              role: 'user',
              content: `The following ShopManifest JSON failed validation. Fix EVERY error listed below and return ONLY the corrected raw JSON (no code fences, no prose).\n\nErrors:\n${errSummary}\n\nJSON to fix:\n${bestMerge.slice(0, 60000)}`,
            }],
          })
          const repairText = repair.content[0].type === 'text' ? repair.content[0].text : ''
          manifest = parseManifestJson(jsonrepair(repairText)) as ShopManifest
        } catch (repairErr) {
          console.error('[iterate] repair failed:', repairErr)
          send({ type: 'error', message: 'Could not parse the updated manifest. Try again.' }); return
        }
      }
    }

    const { data: version, error: versionError } = await supabase
      .from('manifest_versions').insert({
        project_id: projectId,
        version_no: current.version_no + 1,
        manifest,
        prompt: instruction,
      })
      .select().single()

    if (versionError || !version) {
      send({ type: 'error', message: 'Failed to save updated manifest.' }); return
    }

    await Promise.all([
      supabaseAdmin.from('credit_ledger').insert({
        user_id: userId,
        delta: -ITERATE_COST,
        reason: 'iterate',
        ref_id: version.id,
        balance_after: balance - ITERATE_COST,
      }),
      supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId),
    ])

    send({ type: 'done', reply: replyText, manifest, projectId, versionId: version.id })
  })
}
