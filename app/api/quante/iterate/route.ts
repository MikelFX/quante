import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_CODE_ITERATION } from '@/lib/claude'
import { createPreviewDeployment, ensureVercelProject } from '@/lib/hosting/vercel'
import { buildStoreFiles } from '@/lib/store-template/build'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS, RATE_LIMITS, AGENCY_RATE_LIMIT_PER_MIN, AGENCY_TOKEN_CAP } from '@/lib/config'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 300

const ITERATE_COST = CREDIT_COSTS.iterate
const ITERATE_RATE_LIMIT = RATE_LIMITS.iterate
const MAX_TOKENS = 64000

interface IterateOutput {
  files: CodeVersionFiles
  reply: string
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

function parseIterateOutput(raw: string): IterateOutput {
  const files: CodeVersionFiles = {}

  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  let match
  while ((match = fileRegex.exec(raw)) !== null) {
    files[match[1].trim()] = match[2].replace(/^\n/, '').replace(/\n$/, '')
  }

  const replyMatch = raw.match(/<reply>([\s\S]*?)<\/reply>/)
  const reply = replyMatch ? replyMatch[1].trim() : 'Done.'

  return { files, reply }
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const body = await request.json()
    const projectId: string = body.projectId
    const instruction: string = body.instruction?.trim() ?? ''

    if (!projectId || !instruction) {
      send({ type: 'error', message: 'projectId and instruction are required.' }); return
    }

    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    const supabase = await createClient()
    const agency = await isAgencyUser(userId)

    // Ownership check
    const { data: project } = await supabase
      .from('projects').select('id, name, vercel_project_id').eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (!project) { send({ type: 'error', message: 'Project not found.' }); return }

    let balance = 0

    if (agency) {
      // Agency: per-minute rate limit on code_versions (no credit check)
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString()
      const { count: recentCount } = await supabase
        .from('code_versions').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', oneMinAgo)
      if ((recentCount ?? 0) >= AGENCY_RATE_LIMIT_PER_MIN) {
        send({ type: 'error', message: `Rate limit reached — max ${AGENCY_RATE_LIMIT_PER_MIN} updates per minute.` }); return
      }
    } else {
      // Credit tier: hourly rate limit + balance check
      const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
      const { count: recentCount } = await supabase
        .from('credit_ledger').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('reason', 'iterate').gte('created_at', oneHourAgo)
      if ((recentCount ?? 0) >= ITERATE_RATE_LIMIT) {
        send({ type: 'error', message: `Rate limit reached — max ${ITERATE_RATE_LIMIT} store updates per hour.` }); return
      }
      const { data: ledger } = await supabase
        .from('credit_ledger').select('balance_after')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      balance = ledger?.balance_after ?? 0
      if (balance < ITERATE_COST) {
        send({ type: 'error', message: `Insufficient credits. Need ${ITERATE_COST}, have ${balance}.` }); return
      }
    }

    // Load current code version
    const { data: current } = await supabase
      .from('code_versions').select('files, version_no')
      .eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).maybeSingle()
    if (!current) { send({ type: 'error', message: 'No code version found for this project. Generate a store first.' }); return }

    const currentFiles = current.files as CodeVersionFiles

    // Build file summary for Claude (list of files + content)
    const fileSummary = Object.entries(currentFiles)
      .map(([path, content]) => `=== ${path} ===\n${content}`)
      .join('\n\n')

    const userMessage = `CURRENT FILES:\n${fileSummary}\n\nUSER INSTRUCTION:\n${instruction}`

    send({ type: 'status', text: 'Updating your store…' })

    // Stream Claude response, streaming reply tag content in real time
    let rawOutput = ''
    let replyEmitted = ''
    let inReply = false

    const claudeStream = anthropic.messages.stream({
      model: ITERATION_MODEL,
      max_tokens: agency ? AGENCY_TOKEN_CAP : MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_ITERATION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        rawOutput += event.delta.text

        // Stream content inside <reply>...</reply> as it arrives
        if (!inReply) {
          const start = rawOutput.indexOf('<reply>')
          if (start !== -1) inReply = true
        }
        if (inReply) {
          const full = rawOutput
          const start = full.indexOf('<reply>') + '<reply>'.length
          const end = full.indexOf('</reply>')
          const replyContent = end !== -1 ? full.slice(start, end) : full.slice(start)
          if (replyContent.length > replyEmitted.length) {
            const newText = replyContent.slice(replyEmitted.length)
            replyEmitted = replyContent
            if (newText) send({ type: 'text_chunk', text: newText })
          }
        }
      }
    }

    // Parse the full output
    let output: IterateOutput
    try {
      output = parseIterateOutput(rawOutput)
    } catch {
      send({ type: 'error', message: 'Could not parse the updated files. Try again.' }); return
    }

    // Merge changed files with current files
    const mergedFiles: CodeVersionFiles = { ...currentFiles, ...output.files }

    // Save new code version
    const { data: version, error: versionError } = await supabase
      .from('code_versions').insert({
        project_id: projectId,
        user_id: userId,
        version_no: current.version_no + 1,
        files: mergedFiles,
        prompt: instruction,
      })
      .select().single()

    if (versionError || !version) {
      send({ type: 'error', message: 'Failed to save updated files.' }); return
    }

    // Debit credits (skipped for agency)
    const updateProject = supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)
    if (!agency) {
      await Promise.all([
        updateProject,
        supabaseAdmin.from('credit_ledger').insert({
          user_id: userId,
          delta: -ITERATE_COST,
          reason: 'iterate',
          ref_id: version.id,
          balance_after: balance - ITERATE_COST,
        }),
      ])
    } else {
      await updateProject
    }

    // Auto-trigger preview deployment (free)
    send({ type: 'status', text: 'Deploying preview…' })

    let deploymentId: string | null = null
    let previewUrl: string | null = null

    try {
      const slug = (project.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const { vercelProjectId } = await ensureVercelProject(slug)

      if (!project.vercel_project_id) {
        await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', projectId)
      }

      const allFiles = buildStoreFiles(mergedFiles)
      const result = await createPreviewDeployment(
        vercelProjectId,
        allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
      )
      deploymentId = result.deploymentId
      previewUrl = result.url

      await supabaseAdmin.from('deployments').insert({
        project_id: projectId,
        user_id: userId,
        vercel_project_id: vercelProjectId,
        vercel_deployment_id: deploymentId,
        status: 'building',
        url: previewUrl.startsWith('https://') ? previewUrl : `https://${previewUrl}`,
        domain: null,
        version: version.version_no,
        version_id: version.id,
        code_version_id: version.id,
      })
    } catch (err) {
      console.error('[iterate] preview deployment failed (non-fatal):', err)
    }

    send({ type: 'text_chunk', text: '' }) // flush any pending text_chunk
    send({ type: 'done', reply: output.reply, versionId: version.id, deploymentId, previewUrl, projectId })
  })
}
