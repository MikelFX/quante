import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, GENERATION_MODEL, SYSTEM_PROMPT_CODE_GENERATION } from '@/lib/claude'
import { createPreviewDeployment, ensureVercelProject } from '@/lib/hosting/vercel'
import { buildStoreFiles } from '@/lib/store-template/build'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS, RATE_LIMITS, AGENCY_RATE_LIMIT_PER_MIN, AGENCY_TOKEN_CAP } from '@/lib/config'
import type { StoreCodeOutput } from '@/types/store-code'

export const maxDuration = 300

const GENERATE_COST = CREDIT_COSTS.generate
const GENERATE_RATE_LIMIT = RATE_LIMITS.generate
const MAX_TOKENS = 64000

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

function parseCodeOutput(raw: string): StoreCodeOutput {
  const files: Record<string, string> = {}

  // Extract <file path="...">content</file> blocks
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  let match
  while ((match = fileRegex.exec(raw)) !== null) {
    files[match[1].trim()] = match[2].replace(/^\n/, '').replace(/\n$/, '')
  }

  if (Object.keys(files).length === 0) throw new Error('No <file> blocks found in output')

  // Extract <summary>...</summary>
  const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Store generated.'

  return { files, summary }
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const { brief, projectName, projectId: existingProjectId } = await request.json()

    if (!brief?.trim()) { send({ type: 'error', message: 'Brief is required.' }); return }

    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const supabase = await createClient()
    const agency = await isAgencyUser(userId)

    let balance = 0

    if (agency) {
      // Agency: per-minute rate limit on code_versions (no credit check)
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString()
      const { count: recentCount } = await supabase
        .from('code_versions').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', oneMinAgo)
      if ((recentCount ?? 0) >= AGENCY_RATE_LIMIT_PER_MIN) {
        send({ type: 'error', message: `Rate limit reached — max ${AGENCY_RATE_LIMIT_PER_MIN} generations per minute.` })
        return
      }
    } else {
      // Credit tier: balance check + hourly rate limit
      const { data: ledger } = await supabase
        .from('credit_ledger').select('balance_after')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      balance = ledger?.balance_after ?? 0
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
    }

    send({ type: 'status', text: 'Designing your store…' })

    // Call Claude
    let rawOutput = ''
    const claudeStream = anthropic.messages.stream({
      model: GENERATION_MODEL, max_tokens: agency ? AGENCY_TOKEN_CAP : MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_GENERATION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: brief.trim() }],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text
      }
    }

    send({ type: 'status', text: 'Parsing generated files…' })

    // Parse the output
    let output: StoreCodeOutput
    try {
      output = parseCodeOutput(rawOutput)
    } catch {
      send({ type: 'error', message: 'Could not parse generated files. Please try again.' })
      return
    }

    send({ type: 'status', text: 'Saving…' })

    // Create or use project
    let projectId = existingProjectId
    if (!projectId) {
      // Try to derive a name from config if available
      let storeName = projectName ?? 'My Store'
      try {
        const configFile = output.files['data/config.ts'] ?? ''
        const nameMatch = configFile.match(/name:\s*['"]([^'"]+)['"]/)
        if (nameMatch) storeName = nameMatch[1]
      } catch {}

      const { data: project, error: projError } = await supabase
        .from('projects').insert({ user_id: userId, name: storeName, status: 'draft' })
        .select().single()
      if (projError || !project) { send({ type: 'error', message: 'Failed to create project.' }); return }
      projectId = project.id
    }

    // Save code version
    const { data: version, error: versionError } = await supabase
      .from('code_versions').insert({
        project_id: projectId,
        user_id: userId,
        version_no: 1,
        files: output.files,
        prompt: brief,
      })
      .select().single()

    if (versionError || !version) { send({ type: 'error', message: 'Failed to save generated files.' }); return }

    // Debit credits (skipped for agency)
    if (!agency) {
      await supabase.from('credit_ledger').insert({
        user_id: userId, delta: -GENERATE_COST, reason: 'generate',
        ref_id: version.id, balance_after: balance - GENERATE_COST,
      })
    }
    await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

    // Auto-trigger preview deployment (free, no credit debit)
    send({ type: 'status', text: 'Starting preview deployment…' })

    let deploymentId: string | null = null
    let previewUrl: string | null = null

    try {
      // Load project to get vercel_project_id
      const { data: projectRow } = await supabaseAdmin
        .from('projects').select('name, vercel_project_id').eq('id', projectId).single()

      const slug = (projectRow?.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const { vercelProjectId } = await ensureVercelProject(slug)

      if (!projectRow?.vercel_project_id) {
        await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', projectId)
      }

      // Build scaffold + merge AI files
      const allFiles = buildStoreFiles(output.files)

      const result = await createPreviewDeployment(
        vercelProjectId,
        allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
      )
      deploymentId = result.deploymentId
      previewUrl = result.url

      // Save preview deployment row
      await supabaseAdmin.from('deployments').insert({
        project_id: projectId,
        user_id: userId,
        vercel_project_id: vercelProjectId,
        vercel_deployment_id: deploymentId,
        status: 'building',
        url: previewUrl.startsWith('https://') ? previewUrl : `https://${previewUrl}`,
        domain: null,
        version: 1,
        version_id: version.id,
        code_version_id: version.id,
      })
    } catch (err) {
      console.error('[generate] preview deployment failed (non-fatal):', err)
    }

    send({ type: 'done', projectId, versionId: version.id, deploymentId, previewUrl, summary: output.summary })
  })
}
