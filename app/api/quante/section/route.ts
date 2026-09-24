export const maxDuration = 120

import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_SECTION } from '@/lib/claude'
import { ShopManifestSchema, SectionSchema } from '@/lib/manifest-schema'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import type { ShopManifest } from '@/types/manifest'

const SECTION_COST = 2
const SECTION_RATE_LIMIT = 15 // per hour
const MAX_TOKENS = 2048
const MAX_INSTRUCTION_CHARS = 2000
const SOFT_TIMEOUT_MS = 100_000
const PAGES = ['home', 'product', 'collection', 'about', 'contact'] as const
const REFUND_REASON = 'section_failed'
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

function makeStream(fn: (send: (e: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + '\n')) } catch {}
      }
      try {
        await fn(send)
      } catch (err) {
        console.error('[section] failed:', err)
        send({ type: 'error', message: 'Section regeneration failed.' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
}

/**
 * Failure before the stream starts: a single NDJSON error event (the same event shape the
 * stream sends) with a real HTTP status, so e.g. a billing hold is a 402 like the other
 * paid routes. `error` mirrors `message` for JSON-style callers.
 */
function errorResponse(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ type: 'error', message, error: message, ...extra }) + '\n', {
    status,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
}

export async function POST(request: Request) {
  // Pre-flight (validation, ownership, debit) runs BEFORE the stream opens, so refusals
  // carry a real HTTP status (402 for insufficient credits / billing hold).
  const body = await request.json().catch(() => null) as
    { projectId?: unknown; page?: unknown; sectionIndex?: unknown; instruction?: unknown } | null
  const projectId = body?.projectId
  const page = body?.page ?? 'home'
  const sectionIndex = body?.sectionIndex
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''

  if (projectId == null || sectionIndex == null) {
    return errorResponse('projectId and sectionIndex are required.', 400)
  }
  // Strict input validation: `page` indexes into the manifest, so only known pages;
  // sectionIndex must be a real array index.
  if (typeof page !== 'string' || !(PAGES as readonly string[]).includes(page)) {
    return errorResponse('Invalid page.', 400)
  }
  if (typeof sectionIndex !== 'number' || !Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex > 500) {
    return errorResponse('Invalid sectionIndex.', 400)
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return errorResponse(`Instruction is too long — max ${MAX_INSTRUCTION_CHARS} characters.`, 400)
  }

  const { userId } = await auth()
  if (!userId) return errorResponse('Unauthorized.', 401)

  // SECURITY (audit #24): ownership check before reading or writing anything — the
  // service-role client bypasses RLS, so projectId alone would expose any tenant.
  const project = await getOwnedProject<{ id: string }>(projectId, userId, 'id')
  if (!project) return errorResponse('Project not found.', 404)

  const supabase = await createClient()

  const { data: current } = await supabase
    .from('manifest_versions')
    .select('manifest, version_no')
    .eq('project_id', project.id)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!current) return errorResponse('No manifest found.', 404)

  const manifest = current.manifest as ShopManifest
  const pages = (manifest?.pages ?? {}) as Record<string, unknown>
  const pageSections = Object.prototype.hasOwnProperty.call(pages, page) && Array.isArray(pages[page])
    ? (pages[page] as unknown[])
    : []
  const targetSection = pageSections[sectionIndex]

  if (!targetSection) {
    return errorResponse(`No section at index ${sectionIndex} on page "${page}".`, 404)
  }

  // Debit atomically BEFORE calling Claude (audit #1); the new version id is the ref.
  const versionId = randomUUID()
  const debit = await debitCredits(userId, SECTION_COST, 'section', versionId)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return errorResponse(`Insufficient credits. Need ${SECTION_COST}, have ${debit.balance ?? 0}.`, 402)
    }
    if (debit.error === 'billing_hold') {
      return errorResponse(BILLING_HOLD_MESSAGE, 402, { code: 'billing_hold' })
    }
    return errorResponse('Could not reserve credits. Try again.', 500)
  }

  return makeStream(async (send) => {
    let delivered = false
    try {
      // Rate limit: max 15 section regenerations per hour — counted after our own debit
      // so concurrent requests can't all slip under it.
      const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
      const { count: recentCount } = await supabase
        .from('credit_ledger')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('reason', 'section')
        .gte('created_at', oneHourAgo)

      if ((recentCount ?? 0) > SECTION_RATE_LIMIT) {
        send({ type: 'error', message: `Rate limit reached — max ${SECTION_RATE_LIMIT} section regenerations per hour.` })
        return
      }

      send({ type: 'status', text: 'Regenerating section…' })

      const context = {
        brand: manifest.brand,
        design: { palette: manifest.design?.palette, typography: manifest.design?.typography },
        catalog: {
          currency: manifest.catalog?.currency,
          products: (manifest.catalog?.products ?? []).slice(0, 4),
        },
      }

      const userMessage = `Manifest context:\n${JSON.stringify(context, null, 2)}\n\nSection to improve (${page}[${sectionIndex}]):\n${JSON.stringify(targetSection, null, 2)}\n\nInstruction: ${instruction || 'Improve this section — make it more compelling, specific, and on-brand.'}`

      let rawOutput = ''
      const claudeStream = anthropic.messages.stream({
        model: ITERATION_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT_SECTION, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      })
      const softTimeout = setTimeout(() => claudeStream.abort(), SOFT_TIMEOUT_MS)
      try {
        for await (const event of claudeStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            rawOutput += event.delta.text
          }
        }
      } finally {
        clearTimeout(softTimeout)
      }

      send({ type: 'status', text: 'Patching manifest…' })

      // Parse new section
      let newSection
      try {
        const cleaned = rawOutput.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
        const parsed = JSON.parse(cleaned)
        newSection = SectionSchema.parse(parsed)
      } catch {
        send({ type: 'error', message: 'Regenerated section failed validation. Please try a different instruction.' })
        return
      }

      // Patch manifest
      const updatedManifest = JSON.parse(JSON.stringify(manifest))
      const updatedSections = [...pageSections]
      updatedSections[sectionIndex] = newSection
      updatedManifest.pages[page] = updatedSections

      let validatedManifest
      try {
        validatedManifest = ShopManifestSchema.parse(updatedManifest)
      } catch {
        send({ type: 'error', message: 'Patched manifest failed validation. Please try again.' })
        return
      }

      const { data: version, error } = await supabase
        .from('manifest_versions')
        .insert({
          id: versionId,
          project_id: project.id,
          version_no: current.version_no + 1,
          manifest: validatedManifest,
          prompt: instruction || `Regenerated ${(targetSection as { type: string }).type} section`,
        })
        .select()
        .single()

      if (error || !version) { send({ type: 'error', message: 'Failed to save.' }); return }
      delivered = true

      await supabase.from('projects').update({ updated_at: new Date().toISOString() })
        .eq('id', project.id).eq('user_id', userId)

      send({ type: 'done', projectId: project.id, versionId: version.id, manifest: validatedManifest })
    } finally {
      // Every path that didn't deliver a saved section gives the credits back
      // (rate-limited, Claude error/timeout, validation or save failure).
      if (!delivered) await refundDebit(userId, versionId, 'section', REFUND_REASON)
    }
  })
}
