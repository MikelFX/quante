import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_CODE_FIX } from '@/lib/claude'
import { createPreviewDeployment, createVercelPreviewDeploy, ensureVercelProject } from '@/lib/hosting/vercel'
import { buildStoreFiles } from '@/lib/store-template/build'
import { rateLimit } from '@/lib/rate-limit'
import type { CodeVersionFiles } from '@/types/store-code'

export const maxDuration = 300

// Fixes are free — they repair failures of a generation the user already paid for.
// Rate limit is the abuse guard instead of credits.
const FIX_RATE_LIMIT_PER_HOUR = 30
const MAX_TOKENS = 32000

interface FixOutput {
  file: string
  content: string
  explanation: string
}

function parseFixOutput(raw: string, expectedFilePath: string): FixOutput {
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/
  const fileMatch = raw.match(fileRegex)
  if (!fileMatch) throw new Error('No <file> block found in fix output')

  const explanationMatch = raw.match(/<explanation>([\s\S]*?)<\/explanation>/)
  const explanation = explanationMatch ? explanationMatch[1].trim() : 'Fixed.'

  return {
    file: fileMatch[1].trim() || expectedFilePath,
    content: fileMatch[2].replace(/^\n/, '').replace(/\n$/, ''),
    explanation,
  }
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, errorMessage, filePath } = await request.json()
  if (!projectId || !errorMessage || !filePath) {
    return NextResponse.json({ error: 'projectId, errorMessage, and filePath are required' }, { status: 400 })
  }

  const limited = rateLimit(`fix:${userId}`, FIX_RATE_LIMIT_PER_HOUR, 3_600_000)
  if (!limited.allowed) {
    return NextResponse.json({ error: `Rate limit reached — max ${FIX_RATE_LIMIT_PER_HOUR} fixes per hour.` }, { status: 429 })
  }

  const supabase = await createClient()

  // Ownership check
  const { data: project } = await supabase
    .from('projects').select('id, name, vercel_project_id, hosting_trial_ends_at').eq('id', projectId).eq('user_id', userId).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Load current code version
  const { data: current } = await supabase
    .from('code_versions').select('files, version_no')
    .eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).maybeSingle()
  if (!current) return NextResponse.json({ error: 'No code version found.' }, { status: 404 })

  const currentFiles = current.files as CodeVersionFiles

  // Resolve file: exact → basename match → all-files fallback
  let resolvedPath = filePath
  let fileContent: string | undefined = currentFiles[filePath]

  if (!fileContent && filePath !== 'store') {
    const base = filePath.split('/').pop() ?? ''
    const match = Object.keys(currentFiles).find(k => k.endsWith('/' + base) || k === base)
    if (match) { resolvedPath = match; fileContent = currentFiles[match] }
  }

  let userMessage: string
  if (fileContent) {
    userMessage = `BUILD ERROR:\n${errorMessage}\n\nFILE TO FIX: ${resolvedPath}\n\nFILE CONTENT:\n${fileContent}`
  } else {
    // File can't be pinpointed — send all generated files and ask Claude to find and fix
    const allFilesText = Object.entries(currentFiles)
      .map(([path, content]) => `<file path="${path}">\n${content}\n</file>`)
      .join('\n\n')
    userMessage = `BUILD ERROR:\n${errorMessage}\n\nThe error may be in any of these files. Identify the problematic file and fix it:\n\n${allFilesText}`
    resolvedPath = filePath
  }

  // Call Claude to fix the error (streaming required for long operations)
  let rawOutput = ''
  try {
    const stream = anthropic.messages.stream({
      model: ITERATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT_CODE_FIX,
      messages: [{ role: 'user', content: userMessage }],
    })
    const response = await stream.finalMessage()
    rawOutput = response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fix] Claude call failed:', msg)
    return NextResponse.json({ error: `AI fix request failed: ${msg}` }, { status: 500 })
  }

  // Parse the fix output
  let output: FixOutput
  try {
    output = parseFixOutput(rawOutput, resolvedPath)
  } catch {
    return NextResponse.json({ error: 'Could not parse fix output.' }, { status: 500 })
  }

  // Apply the fix to the current files
  const mergedFiles: CodeVersionFiles = { ...currentFiles, [output.file]: output.content }

  // Save new code version
  const { data: version, error: versionError } = await supabase
    .from('code_versions').insert({
      project_id: projectId,
      user_id: userId,
      version_no: current.version_no + 1,
      files: mergedFiles,
      prompt: `Fix: ${errorMessage.slice(0, 200)}`,
    })
    .select().single()

  if (versionError || !version) {
    return NextResponse.json({ error: 'Failed to save fixed files.' }, { status: 500 })
  }

  await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

  // Auto-trigger preview deployment.
  // Fix (2026-08-07): use the real production deploy (target + subdomain) only once the
  // store has actually gone live at least once (hosting_trial_ends_at set by /api/deploy
  // on first successful Push to Live) — matches the same fix applied to /api/quante/generate
  // and /api/quante/iterate. Pre-publish auto-fix runs were silently doing full production
  // builds + public subdomain attach for a store nobody had published yet.
  const isLive = !!project.hosting_trial_ends_at
  let deploymentId: string | null = null
  let previewUrl: string | null = null

  try {
    const slug = (project.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { vercelProjectId } = await ensureVercelProject(slug)

    if (!project.vercel_project_id) {
      await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', projectId)
    }

    const allFiles = buildStoreFiles(mergedFiles)
    const filesPayload = allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' }))
    const result = isLive
      ? await createPreviewDeployment(vercelProjectId, filesPayload, slug)
      : await createVercelPreviewDeploy(vercelProjectId, filesPayload, slug)
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
    console.error('[fix] preview deployment failed (non-fatal):', err)
  }

  return NextResponse.json({
    versionId: version.id,
    deploymentId,
    previewUrl,
    explanation: output.explanation,
  })
}
