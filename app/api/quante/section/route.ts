import { createClient } from '@/lib/supabase/server'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_SECTION } from '@/lib/claude'
import { ShopManifestSchema, SectionSchema } from '@/lib/manifest-schema'
import type { ShopManifest } from '@/types/manifest'

const SECTION_COST = 2
const SECTION_RATE_LIMIT = 15 // per hour
const MAX_TOKENS = 2048

function makeStream(fn: (send: (e: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: object) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      try { await fn(send) } finally { controller.close() }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const { projectId, page = 'home', sectionIndex, instruction } = await request.json()

    if (projectId == null || sectionIndex == null) {
      send({ type: 'error', message: 'projectId and sectionIndex are required.' })
      return
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const { data: ledger } = await supabase
      .from('credit_ledger')
      .select('balance_after')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const balance = ledger?.balance_after ?? 0
    if (balance < SECTION_COST) {
      send({ type: 'error', message: `Insufficient credits. Need ${SECTION_COST}, have ${balance}.` })
      return
    }

    // Rate limit: max 15 section regenerations per hour
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count: recentCount } = await supabase
      .from('credit_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('reason', 'section')
      .gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= SECTION_RATE_LIMIT) {
      send({ type: 'error', message: `Rate limit reached — max ${SECTION_RATE_LIMIT} section regenerations per hour.` })
      return
    }

    const { data: current } = await supabase
      .from('manifest_versions')
      .select('manifest, version_no')
      .eq('project_id', projectId)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!current) { send({ type: 'error', message: 'No manifest found.' }); return }

    const manifest = current.manifest as ShopManifest
    const pageSections = (manifest.pages as Record<string, unknown[]>)[page] ?? []
    const targetSection = pageSections[sectionIndex]

    if (!targetSection) {
      send({ type: 'error', message: `No section at index ${sectionIndex} on page "${page}".` })
      return
    }

    send({ type: 'status', text: 'Regenerating section…' })

    const context = {
      brand: manifest.brand,
      design: { palette: manifest.design.palette, typography: manifest.design.typography },
      catalog: {
        currency: manifest.catalog.currency,
        products: manifest.catalog.products.slice(0, 4),
      },
    }

    const userMessage = `Manifest context:\n${JSON.stringify(context, null, 2)}\n\nSection to improve (${page}[${sectionIndex}]):\n${JSON.stringify(targetSection, null, 2)}\n\nInstruction: ${instruction?.trim() || 'Improve this section — make it more compelling, specific, and on-brand.'}`

    let rawOutput = ''
    const claudeStream = anthropic.messages.stream({
      model: ITERATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_SECTION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text
      }
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
        project_id: projectId,
        version_no: current.version_no + 1,
        manifest: validatedManifest,
        prompt: instruction?.trim() || `Regenerated ${(targetSection as { type: string }).type} section`,
      })
      .select()
      .single()

    if (error || !version) { send({ type: 'error', message: 'Failed to save.' }); return }

    await Promise.all([
      supabase.from('credit_ledger').insert({
        user_id: user.id,
        delta: -SECTION_COST,
        reason: 'section',
        ref_id: version.id,
        balance_after: balance - SECTION_COST,
      }),
      supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId),
    ])

    send({ type: 'done', projectId, versionId: version.id, manifest: validatedManifest })
  })
}
