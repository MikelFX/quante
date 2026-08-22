import { randomUUID } from 'crypto'
import { after, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, MODELS, SYSTEM_PROMPT_CODE_GENERATION } from '@/lib/claude'
import { createVercelPreviewDeploy, ensureVercelProject, summarizeDeploymentFailure } from '@/lib/hosting/vercel'
import { buildStoreFiles } from '@/lib/store-template/build'
import { getUserRecord } from '@/lib/tier'
import { extractFileBlocks } from '@/lib/generation-checkpoint'
import type { StoreCodeOutput } from '@/types/store-code'
import type { GenerationPhase } from '@/lib/generation-poll'

// 300s = Hobby/Pro hard cap. Raise to 800 (Enterprise, current platform max) once
// plan is upgraded, then also raise SOFT_TIMEOUT_MS for slower thinking-mode primaries.
// `after()`'s callback runs within this SAME budget — it does not grant extra time beyond it.
export const maxDuration = 300

const PRIMARY_MODEL = MODELS.generation
const FALLBACK_MODEL = MODELS.fallback
const GENERATE_COST = 10
const GENERATE_RATE_LIMIT = 5
// Sized for the previously-planned 128k-output primary. Opus 4.7 may reject
// this — if the API 400s on max_tokens, drop back to 64000 (current Claude 4
// ceiling) or whatever the target primary actually supports.
const MAX_TOKENS = 128000
// Abort Claude at 270s — leaves 30s for the after()-scheduled save/cleanup (parseCodeOutput,
// code_versions insert, credit debit, preview deploy kickoff) to finish before Vercel's hard
// 300s maxDuration cap kills the function instance mid-write. This is deliberately pushed to
// the safe ceiling on Pro (300s cap) rather than the previous 240s — the extra 30s inside
// Claude's stream is a meaningful buffer for the primary 128k-output opus 4.7 run.
// Raise to ~500_000-700_000 once maxDuration is increased to 800 on Enterprise.
const SOFT_TIMEOUT_MS = 270_000
// Level 3: how often the in-flight raw output is checkpointed to generation_jobs while
// Claude is streaming. Shorter than Level 1's original 15s — that cadence was tied to an
// NDJSON keepalive ping (avoiding proxy idle timeouts on an open connection); there is no
// open connection anymore, so this interval is purely about how "live" the polling client's
// progress view feels. 4s is frequent enough to feel responsive without hammering Supabase.
const CHECKPOINT_INTERVAL_MS = 4_000

const CORE_FILES = [
  'data/products.ts',
  'data/config.ts',
  'styles/store.css',
  'components/store/HomePage.tsx',
]

function parseCodeOutput(raw: string): StoreCodeOutput {
  // extractFileBlocks() is shared with the in-flight checkpoint (see
  // lib/generation-checkpoint.ts) so "what counts as a complete file" never drifts
  // between the two call sites.
  const files = extractFileBlocks(raw)

  if (Object.keys(files).length === 0) {
    throw new Error('Generation produced no files. Please try again with a shorter brief.')
  }

  const missing = CORE_FILES.filter(f => !files[f])
  if (missing.length > 0) {
    throw new Error(`Generation incomplete — missing: ${missing.join(', ')}. Please try again.`)
  }

  const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Store generated.'

  return { files, summary }
}

interface RunParams {
  jobId: string
  userId: string
  brief: string
  projectName: string | undefined
  existingProjectId: string | undefined
  balance: number
}

// ── Architecture note (Level 3 — see docs/update-log.md) ──────────────────────────────
// Everything below used to run inline in the POST handler, streaming NDJSON progress back
// over the same HTTP response the client's fetch() was reading. That tied the entire
// generation's lifetime to the client's connection staying open — nothing in the code
// enforced it, but nothing decoupled it either, and the real-world behavior depended on
// how the platform handles a dropped client mid-response (see the diagnosis earlier in
// this conversation). `after()` removes the ambiguity outright: the POST handler responds
// immediately once the generation_jobs row exists, and this function runs afterward, in
// the same function instance, but explicitly NOT gated on anyone still listening. A device
// dying, a tab closing, a network drop — none of it stops this from running to completion
// (bounded by `maxDuration`, same as before). The client's only connection to this work
// now is polling GET /api/quante/generate/status?jobId=..., which reads exactly the state
// this function is writing here — there is no other channel.
async function runGeneration(params: RunParams): Promise<void> {
  const { jobId, userId, brief, projectName, existingProjectId, balance } = params

  async function setPhase(phase: GenerationPhase) {
    try {
      await supabaseAdmin.from('generation_jobs').update({ phase }).eq('id', jobId)
    } catch (err) {
      console.error('[generate:bg] setPhase write failed (non-fatal):', err)
    }
  }

  async function failJob(message: string) {
    try {
      await supabaseAdmin.from('generation_jobs').update({ status: 'failed', error: message }).eq('id', jobId)
    } catch (err) {
      console.error('[generate:bg] failJob write failed:', err)
    }
  }

  let lastCheckpointedRawLength = 0
  async function checkpoint(currentRawOutput: string, currentModel: string) {
    if (currentRawOutput.length === lastCheckpointedRawLength) return
    lastCheckpointedRawLength = currentRawOutput.length
    try {
      await supabaseAdmin
        .from('generation_jobs')
        .update({
          raw_output: currentRawOutput,
          files: extractFileBlocks(currentRawOutput),
          model_used: currentModel,
        })
        .eq('id', jobId)
    } catch (err) {
      console.error('[generate:bg] checkpoint write failed (non-fatal):', err)
    }
  }

  try {
    await setPhase('designing')

    // --- Market override ---
    // If the merchant has explicitly set project_secrets.market_country/market_language
    // (via the Publish panel's "Storefront market & language" control), that overrides
    // whatever the AI would otherwise infer from the brief text. Only applies to existing
    // projects — a brand-new project has no project_secrets row yet, so it always falls
    // back to pure inference, same as before.
    let effectiveBrief = brief
    if (existingProjectId) {
      try {
        const { data: marketRow } = await supabaseAdmin
          .from('project_secrets')
          .select('market_country, market_language')
          .eq('project_id', existingProjectId)
          .maybeSingle()
        const marketCountry = marketRow?.market_country as string | null | undefined
        const marketLanguage = marketRow?.market_language as string | null | undefined
        if (marketCountry || marketLanguage) {
          const lines: string[] = []
          if (marketCountry) lines.push(`config.brand.country MUST be "${marketCountry}".`)
          if (marketLanguage) lines.push(`config.brand.language MUST be "${marketLanguage}".`)
          effectiveBrief = `${brief}\n\n[Merchant-set market override — takes precedence over anything you'd otherwise infer from the brief above: ${lines.join(' ')} Pick a currency and any other locale-dependent details consistent with this market.]`
        }
      } catch (err) {
        console.error('[generate:bg] market override lookup failed (non-fatal, falling back to inference):', err)
      }
    }

    // --- Primary generation ---
    // Falls back to MODELS.fallback on refusal or hard API error (rate limit, access denied, network).
    // Our own soft-timeout AbortError is NOT treated as a fallback trigger — it goes to partial-file
    // recovery below, the same as before, because by 240s there's no budget left for a second call.
    let rawOutput = ''
    let modelUsed = PRIMARY_MODEL
    let needFallback = false
    let fallbackReason = ''
    let primaryStreamCompleted = false

    const primaryStream = anthropic.messages.stream({
      model: PRIMARY_MODEL, max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_GENERATION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: effectiveBrief }],
    })

    const softAbort = setTimeout(() => {
      console.warn('[generate:bg] soft timeout — aborting primary stream for partial recovery')
      primaryStream.abort()
    }, SOFT_TIMEOUT_MS)

    let lastCheckpointAt = Date.now()
    try {
      for await (const event of primaryStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          rawOutput += event.delta.text
        }
        if (Date.now() - lastCheckpointAt > CHECKPOINT_INTERVAL_MS) {
          lastCheckpointAt = Date.now()
          await checkpoint(rawOutput, modelUsed)
        }
      }
      primaryStreamCompleted = true
    } catch (err) {
      const isOurAbort = err instanceof Error && err.name === 'AbortError'
      if (!isOurAbort) {
        needFallback = true
        fallbackReason = err instanceof Error ? err.message : 'api_error'
      }
    } finally {
      clearTimeout(softAbort)
    }

    if (primaryStreamCompleted) {
      try {
        const finalMsg = await primaryStream.finalMessage()
        if ((finalMsg.stop_reason as string) === 'refusal') {
          needFallback = true
          fallbackReason = 'refusal'
          rawOutput = ''
        }
      } catch {
        // finalMessage() failing after a completed stream is non-fatal — proceed with collected output
      }
    }

    // --- Fallback ---
    if (needFallback) {
      console.warn(`[generate:bg] model=${PRIMARY_MODEL} failed (${fallbackReason}) — retrying with ${FALLBACK_MODEL}`)
      rawOutput = ''
      modelUsed = FALLBACK_MODEL
      await setPhase('retrying_fallback')

      const fallbackStream = anthropic.messages.stream({
        model: FALLBACK_MODEL, max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_GENERATION, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: effectiveBrief }],
      })

      const softAbortFallback = setTimeout(() => {
        console.warn('[generate:bg] soft timeout — aborting fallback stream for partial recovery')
        fallbackStream.abort()
      }, SOFT_TIMEOUT_MS)

      lastCheckpointAt = Date.now()
      try {
        for await (const event of fallbackStream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            rawOutput += event.delta.text
          }
          if (Date.now() - lastCheckpointAt > CHECKPOINT_INTERVAL_MS) {
            lastCheckpointAt = Date.now()
            await checkpoint(rawOutput, modelUsed)
          }
        }
      } catch {
        // Partial file recovery for fallback stream too
      } finally {
        clearTimeout(softAbortFallback)
      }
    }

    console.warn(`[generate:bg] model_used=${modelUsed} project=${existingProjectId ?? '(new)'} job=${jobId}`)

    await setPhase('parsing')

    // Parse the output — succeeds even with partial output as long as all 4 core files are present
    let output: StoreCodeOutput
    try {
      output = parseCodeOutput(rawOutput)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Could not parse generated files. Please try again.')
    }

    await setPhase('saving')

    // Create or use project
    let projectId = existingProjectId
    if (!projectId) {
      let storeName = projectName ?? 'My Store'
      try {
        const configFile = output.files['data/config.ts'] ?? ''
        const nameMatch = configFile.match(/name:\s*['"]([^'"]+)['"]/)
        if (nameMatch) storeName = nameMatch[1]
      } catch {}

      const { data: project, error: projError } = await supabaseAdmin
        .from('projects').insert({ user_id: userId, name: storeName, status: 'draft' })
        .select().single()
      if (projError || !project) throw new Error('Failed to create project.')
      projectId = project.id
      // Surface the newly created project id on the job as soon as we have it — a client
      // polling status can navigate to it even if something later (deploy, credit debit)
      // has trouble, rather than waiting for every last step to succeed first.
      try {
        await supabaseAdmin.from('generation_jobs').update({ project_id: projectId }).eq('id', jobId)
      } catch (err) {
        console.error('[generate:bg] project_id checkpoint write failed (non-fatal):', err)
      }
    }

    // Save code version
    const { data: version, error: versionError } = await supabaseAdmin
      .from('code_versions').insert({
        project_id: projectId,
        user_id: userId,
        version_no: 1,
        files: output.files,
        prompt: brief,
      })
      .select().single()

    if (versionError || !version) throw new Error('Failed to save generated files.')

    // Work is durably saved as of this point (code_versions row exists). Record that on
    // the job immediately — credit debit and preview deploy below can still fail
    // independently without losing the generated code, and status only flips to
    // 'completed' once this whole function returns (see the outer try/catch), but
    // code_version_id/files/summary being populated here means a client that times out
    // waiting can still find its way to the project even before the final status flip.
    try {
      await supabaseAdmin
        .from('generation_jobs')
        .update({ code_version_id: version.id, files: output.files, summary: output.summary, model_used: modelUsed })
        .eq('id', jobId)
    } catch (err) {
      console.error('[generate:bg] code_version checkpoint write failed (non-fatal):', err)
    }

    // Debit credits — refunded via /api/credits/refund if the auto-fix loop gives up
    const { error: debitError } = await supabaseAdmin.from('credit_ledger').insert({
      user_id: userId, delta: -GENERATE_COST, reason: 'generate',
      ref_id: version.id, balance_after: balance - GENERATE_COST,
    })
    if (debitError) {
      console.error('[generate:bg] credit debit failed:', debitError)
    } else {
      try {
        await supabaseAdmin.from('generation_jobs').update({ credits_debited: true }).eq('id', jobId)
      } catch (err) {
        console.error('[generate:bg] markCreditsDebited write failed (non-fatal):', err)
      }
    }
    await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

    // Validation-only deploy (free, no credit debit, NOT the real "go live" deploy).
    //
    // Fix (2026-08-07): this used to call createPreviewDeployment(), which despite its
    // name deploys with target: 'production' AND attaches the store's public subdomain
    // (see lib/hosting/vercel.ts). That meant every first-time generation silently did a
    // full *production* Vercel build and made the subdomain publicly reachable — before
    // the merchant ever clicked "Push to Live". StudioClient then always hides that
    // deployment's result behind the "Push to Live" screen (see showPushToLive in
    // StudioClient.tsx) and, when the user actually clicks it, /api/deploy runs a SECOND,
    // completely redundant production build of the identical files — the only one that's
    // properly wired up with QUANTE_API_KEY, the hosting trial timer, and the real credit
    // debit. Net effect: two full production builds back-to-back for one generation.
    //
    // This step still needs to exist — its deploymentId feeds startLogStreaming() in
    // StudioClient, which is how build errors are caught and the self-healing auto-fix
    // loop (autoFixAttempts) gets triggered *before* the user ever sees a failure. So
    // instead of removing it, it now uses createVercelPreviewDeploy() — a true Vercel
    // preview build: no target: 'production', no domain attach, no public subdomain
    // exposure. /api/deploy (Push to Live) is unchanged and remains the one and only
    // production deployment + domain attach + credit debit.
    await setPhase('validating_build')

    let deploymentId: string | null = null
    let previewUrl: string | null = null
    // Structured summary of a deploy failure, if any — persisted to generation_jobs.deploy_error
    // so the polling client (and future post-mortems via the dashboard) can see exactly why
    // Vercel refused. Previously this catch just logged '(non-fatal)' and returned, which is
    // how the 2026-08-18 stall bug still slipped through even after that day's cosmetic fix.
    let deployError: string | null = null

    try {
      const { data: projectRow } = await supabaseAdmin
        .from('projects').select('name, vercel_project_id').eq('id', projectId).single()

      const slug = (projectRow?.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const { vercelProjectId } = await ensureVercelProject(slug)

      if (!projectRow?.vercel_project_id) {
        await supabaseAdmin.from('projects').update({ vercel_project_id: vercelProjectId }).eq('id', projectId)
      }

      const allFiles = buildStoreFiles(output.files)

      const result = await createVercelPreviewDeploy(
        vercelProjectId,
        allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
        slug,
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
        version: 1,
        version_id: version.id,
        code_version_id: version.id,
      })
    } catch (err) {
      // Log FULL detail (status, response body, SDK message) — not just err.message — so a
      // silent Vercel 4xx/5xx that used to just say "(non-fatal)" is diagnosable from the
      // server logs alone. summarizeDeploymentFailure() pulls the useful fields off Vercel
      // SDK errors, fetch failures, and our own assertDeploymentResult throw.
      const summary = summarizeDeploymentFailure(err)
      console.error('[generate:bg] preview deployment failed:', {
        ...summary,
        stack: err instanceof Error ? err.stack : undefined,
      })
      const parts = [summary.message]
      if (summary.status !== undefined) parts.push(`status=${summary.status}`)
      if (summary.body !== undefined) {
        try { parts.push(`body=${JSON.stringify(summary.body).slice(0, 400)}`) } catch { /* ignore */ }
      }
      deployError = parts.join(' | ').slice(0, 1000)
    }

    // Note the job status: 'completed' even when the deploy failed, because the generated
    // code IS saved (code_versions row exists) and the user can still iterate on it — the
    // deploy is an orthogonal step that can retry. deploy_error carries the reason so the
    // client can distinguish "success, subdomain live" from "success, but no preview yet".
    // Defensive update: if the deploy_error column doesn't exist yet (migration not run),
    // fall back to writing without it so the completion signal still lands.
    const jobUpdate: Record<string, unknown> = {
      status: 'completed',
      phase: null,
      deployment_id: deploymentId,
      preview_url: previewUrl,
      deploy_error: deployError,
    }
    const { error: jobUpdateError } = await supabaseAdmin
      .from('generation_jobs')
      .update(jobUpdate)
      .eq('id', jobId)
    if (jobUpdateError) {
      console.error('[generate:bg] generation_jobs completion update failed, retrying without deploy_error:', jobUpdateError)
      delete jobUpdate.deploy_error
      await supabaseAdmin.from('generation_jobs').update(jobUpdate).eq('id', jobId)
    }
  } catch (err) {
    console.error('[generate:bg] job failed:', err)
    await failJob(err instanceof Error ? err.message : 'Generation failed unexpectedly.')
  }
}

export async function POST(request: Request) {
  const { brief, projectName, projectId: existingProjectId } = await request.json()

  if (!brief?.trim()) {
    return NextResponse.json({ error: 'Brief is required.' }, { status: 400 })
  }

  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const supabase = await createClient()

  // Credits check
  const { data: ledger } = await supabase
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const balance = ledger?.balance_after ?? 0
  if (balance < GENERATE_COST) {
    return NextResponse.json({ error: `Insufficient credits. Need ${GENERATE_COST}, have ${balance}.` }, { status: 402 })
  }

  // Rate limit
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count: recentCount } = await supabase
    .from('credit_ledger').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('reason', 'generate').gte('created_at', oneHourAgo)

  if ((recentCount ?? 0) >= GENERATE_RATE_LIMIT) {
    return NextResponse.json(
      { error: `Rate limit reached — max ${GENERATE_RATE_LIMIT} generations per hour.` },
      { status: 429 },
    )
  }

  // Project limit check — fail fast before calling Claude (only when creating a new project)
  if (!existingProjectId) {
    const record = await getUserRecord(userId)
    const { count: activeCount } = await supabase
      .from('projects').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).neq('status', 'archived')
    if ((activeCount ?? 0) >= record.project_limit) {
      return NextResponse.json({
        error: `Active project limit reached (${activeCount ?? 0}/${record.project_limit}). Delete a project first, or upgrade to Agency for up to 20 stores.`,
      }, { status: 403 })
    }
  }

  // The generation_jobs row is what the client polls — unlike Level 1 (where a failed
  // insert here just meant "no checkpointing this run, generation proceeds anyway"), this
  // is now load-bearing: with no job row, there is nothing for the client to poll, so a
  // failed insert here must fail the whole request rather than silently degrading.
  const { data: job, error: jobError } = await supabase
    .from('generation_jobs')
    .insert({
      id: randomUUID(),
      user_id: userId,
      project_id: existingProjectId ?? null,
      brief: brief.trim(),
      status: 'running',
      phase: 'designing',
    })
    .select('id')
    .single()

  if (jobError || !job) {
    console.error('[generate] generation_jobs insert failed:', jobError)
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }

  // Scheduled to run after this response is sent — explicitly decoupled from the client's
  // HTTP connection (see the long comment on runGeneration above). Uses supabaseAdmin
  // (service role) throughout rather than the request-scoped `supabase` client above,
  // since everything past this point runs outside the normal request lifecycle.
  after(() => runGeneration({
    jobId: job.id,
    userId,
    brief: brief.trim(),
    projectName: projectName?.trim() || undefined,
    existingProjectId: existingProjectId ?? undefined,
    balance,
  }))

  return NextResponse.json({ jobId: job.id, projectId: existingProjectId ?? null }, { status: 202 })
}
