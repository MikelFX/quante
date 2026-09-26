import { randomUUID } from 'crypto'
import { after, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, MODELS, SYSTEM_PROMPT_CODE_GENERATION } from '@/lib/claude'
import { createVercelPreviewDeploy, ensureProjectVercel, summarizeDeploymentFailure } from '@/lib/hosting/vercel'
import { buildStoreFiles, filterAiStoreFiles, SCAFFOLD_VERSION } from '@/lib/store-template/build'
import { withTokenClasses } from '@/lib/store-template/style-codemod'
import { insertDeploymentRow } from '@/lib/hosting/deployments'
import { getUserRecord } from '@/lib/tier'
import {
  AI_FILTER_PROMPT_NOTE,
  describeDroppedFiles,
  extractFileBlocks,
  normalizeDroppedFiles,
  type DroppedFile,
} from '@/lib/generation-checkpoint'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { refundCapped } from '@/app/api/credits/refund/capped'
import type { StoreCodeOutput } from '@/types/store-code'
import type { GenerationPhase } from '@/lib/generation-poll'

// 300s = Hobby/Pro hard cap. Raise to 800 (Enterprise, current platform max) once
// plan is upgraded, then also raise SOFT_TIMEOUT_MS for slower thinking-mode primaries.
// `after()`'s callback runs within this SAME budget — it does not grant extra time beyond it.
export const maxDuration = 300

import { CREDIT_COSTS } from '@/lib/config'

const PRIMARY_MODEL = MODELS.generation
const FALLBACK_MODEL = MODELS.fallback
const GENERATE_COST = CREDIT_COSTS.generate
// Counts generation_jobs rows of EVERY status (failed ones included) — failed runs still
// burn a full model call on our side, so they must count toward the hourly limit.
const GENERATE_RATE_LIMIT = 5
// A 'running' job younger than this blocks a new generation (one in-flight job per user).
// Older 'running' rows are treated as dead (function killed past maxDuration).
const IN_FLIGHT_WINDOW_MS = 10 * 60_000
// Refunds for failures caused by the model's own output (incomplete/unparseable files, or
// a job that died mid-run) are capped per day — otherwise a brief crafted to fail makes the
// model free to use (and its streamed output is visible while the job runs). The cap is
// counted from credit_refund_claims (see app/api/credits/refund/capped.ts, shared with
// /api/credits/refund), so uncapped infra refunds never use it up.
const MAX_BRIEF_CHARS = 20_000
const REFUND_REASON = 'generation_failed'
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'
// Sized for the previously-planned 128k-output primary. Opus 4.7 may reject
// this — if the API 400s on max_tokens, drop back to 64000 (current Claude 4
// ceiling) or whatever the target primary actually supports.
const MAX_TOKENS = 128000
// Abort Claude at 270s — leaves 30s for the after()-scheduled save/cleanup (parseCodeOutput,
// code_versions insert, preview deploy kickoff; credits are debited up front in POST) to finish before Vercel's hard
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

// A core file removed by our own safety filter (filterAiStoreFiles) fails the job. The
// filter can reject ordinary copy (`tags: ['global']`, `<dt>Function</dt>`), so such a
// failure is usually not the user's fault and is refunded outside the daily refund cap —
// but a user can also provoke a rejection on purpose (after watching the streamed
// output), so that uncapped allowance is small and counted separately; past it, the
// normal capped refund applies. Counted from this user's failed jobs whose error starts
// with FILTER_FAIL_PREFIX (only one job runs per user at a time, so no race).
const FILTER_FAIL_PREFIX = 'Generation produced files that failed safety checks'
const FILTER_REFUNDS_PER_DAY = 2

class FilterRejectedError extends Error {
  constructor(readonly rejected: DroppedFile[]) {
    super(
      `${FILTER_FAIL_PREFIX}: ${describeDroppedFiles(rejected)}. Please try again` +
      ' (rephrasing the brief can help if it uses one of the flagged words).',
    )
    this.name = 'FilterRejectedError'
  }
}

/** Uncapped filter-failure refunds this user still has today (0 when the lookup fails). */
async function filterRefundAllowanceLeft(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'failed')
    .like('error', `${FILTER_FAIL_PREFIX}%`)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if (error) {
    console.error('[generate] filter-refund allowance lookup failed:', error.message)
    return 0
  }
  return Math.max(0, FILTER_REFUNDS_PER_DAY - (count ?? 0))
}

function parseCodeOutput(raw: string): StoreCodeOutput & { dropped: DroppedFile[] } {
  // extractFileBlocks() is shared with the in-flight checkpoint (see
  // lib/generation-checkpoint.ts) so "what counts as a complete file" never drifts
  // between the two call sites.
  const extracted = extractFileBlocks(raw)

  if (Object.keys(extracted).length === 0) {
    throw new Error('Generation produced no files. Please try again with a shorter brief.')
  }

  // SECURITY (audit #23): only allowlisted store paths with no server-side capabilities
  // may be saved to code_versions or deployed. Everything else is dropped here, before
  // anything is persisted; buildStoreFiles() re-applies the same filter at deploy time.
  const { files, dropped } = filterAiStoreFiles(withTokenClasses(extracted))
  if (dropped.length > 0) {
    console.warn('[generate:bg] dropped disallowed AI files:', dropped)
  }

  const missing = CORE_FILES.filter(f => !files[f])
  if (missing.length > 0) {
    const rejected = dropped.filter((d) => missing.includes(d.path))
    if (rejected.length > 0) throw new FilterRejectedError(rejected)
    throw new Error(`Generation incomplete — missing: ${missing.join(', ')}. Please try again.`)
  }

  const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/)
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Store generated.'

  return { files, summary, dropped }
}

/**
 * Refunds the generate debit held under `jobId` (ref of the up-front debit). `capped`
 * refunds (failures attributable to the model output / brief) respect the daily limit;
 * uncapped ones are for failures on our side where the user got nothing. refundDebit
 * never refunds more than was debited under this ref, so repeat calls are harmless.
 */
async function refundGeneration(userId: string, jobId: string, capped: boolean): Promise<number> {
  if (capped) {
    const res = await refundCapped(userId, jobId, 'generate', REFUND_REASON)
    if (!res.ok) {
      console.warn(`[generate] capped refund skipped for job=${jobId}: ${res.reason === 'limit' ? 'daily refund cap reached' : 'refund failed'}`)
      return 0
    }
    return res.refunded
  }
  const res = await refundDebit(userId, jobId, 'generate', REFUND_REASON)
  if (!res.ok) console.error(`[generate] refund failed for job=${jobId}`)
  return res.refunded
}

interface RunParams {
  jobId: string
  userId: string
  brief: string
  projectName: string | undefined
  existingProjectId: string | undefined
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
  const { jobId, userId, brief, projectName, existingProjectId } = params
  const startedAt = Date.now()
  // Set once the code_versions row exists — past that point the user has received the
  // paid work, so a later failure is not refunded.
  let codeSaved = false
  // True when the failure is ours (API/network/DB), not the model output — refunded uncapped.
  let infraFailure = false

  async function setPhase(phase: GenerationPhase) {
    try {
      await supabaseAdmin.from('generation_jobs').update({ phase }).eq('id', jobId)
    } catch (err) {
      console.error('[generate:bg] setPhase write failed (non-fatal):', err)
    }
  }

  async function failJob(message: string) {
    try {
      // Drop the checkpointed output of a failed run — status only needs `error`, and
      // keeping the raw model output readable would let a deliberately failing brief be
      // used as a model proxy.
      await supabaseAdmin
        .from('generation_jobs')
        .update({ status: 'failed', error: message, phase: null, raw_output: '', files: {} })
        .eq('id', jobId)
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

    // Server-side note about the safety filter, so ordinary copy doesn't trip it (see
    // AI_FILTER_PROMPT_NOTE). Only sent to the model — code_versions stores `brief`.
    effectiveBrief = `${effectiveBrief}\n\n${AI_FILTER_PROMPT_NOTE}`

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
    // The fallback shares the primary's soft deadline: starting a fresh 270s timer after a
    // late primary failure would run past maxDuration, the platform would kill the function
    // mid-stream and the job would be left 'running' with no failure handling at all.
    const remainingMs = SOFT_TIMEOUT_MS - (Date.now() - startedAt)
    if (needFallback && remainingMs < 20_000) {
      infraFailure = fallbackReason !== 'refusal'
      throw new Error('Generation timed out. Please try again.')
    }
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
      }, remainingMs)

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
      } catch (err) {
        // Partial file recovery for fallback stream too. A hard API error on the fallback
        // after the primary also hit one (not a refusal) is our failure, not the user's.
        const isOurAbort = err instanceof Error && err.name === 'AbortError'
        if (!isOurAbort && fallbackReason !== 'refusal' && rawOutput.length === 0) infraFailure = true
      } finally {
        clearTimeout(softAbortFallback)
      }
    }

    console.warn(`[generate:bg] model_used=${modelUsed} project=${existingProjectId ?? '(new)'} job=${jobId}`)

    await setPhase('parsing')

    // Parse the output — succeeds even with partial output as long as all 4 core files are present
    let output: StoreCodeOutput & { dropped: DroppedFile[] }
    try {
      output = parseCodeOutput(rawOutput)
    } catch (err) {
      if (err instanceof FilterRejectedError) throw err
      throw new Error(err instanceof Error ? err.message : 'Could not parse generated files. Please try again.')
    }

    await setPhase('saving')

    // From here on a failure is a DB/infra problem, not the model output.
    infraFailure = true

    // Create or use project (existingProjectId was ownership-checked in POST)
    let projectId = existingProjectId
    if (!projectId) {
      let storeName = projectName ?? 'My Store'
      try {
        const configFile = output.files['data/config.ts'] ?? ''
        const nameMatch = configFile.match(/name:\s*['"]([^'"]+)['"]/)
        if (nameMatch) storeName = nameMatch[1]
      } catch {}

      // Re-check the project limit right before the insert: POST checked it minutes ago,
      // and a project created meanwhile (POST /api/projects) would otherwise push the
      // user over it. Refunded uncapped (infraFailure) — the user did nothing wrong.
      const record = await getUserRecord(userId)
      const { count: activeCount, error: countError } = await supabaseAdmin
        .from('projects').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).neq('status', 'archived')
      if (countError) throw new Error('Failed to create project.')
      if ((activeCount ?? 0) >= record.project_limit) {
        throw new Error(`Active project limit reached (${activeCount ?? 0}/${record.project_limit}). Delete a project first, then generate again.`)
      }

      const { data: project, error: projError } = await supabaseAdmin
        .from('projects').insert({ user_id: userId, name: storeName, status: 'draft' })
        .select().single()
      if (projError || !project) throw new Error('Failed to create project.')

      // SECURITY (audit #66): the count above and the insert are not atomic — a project
      // created in parallel (POST /api/projects, another tab) can still slip in between.
      // Re-count now that our row exists; if the user is over the limit, remove the row
      // we just created and fail the job. The throw lands in the catch below, which
      // refunds the generate debit (ref = jobId) uncapped, since infraFailure is set.
      const { count: afterCount, error: afterCountError } = await supabaseAdmin
        .from('projects').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).neq('status', 'archived')
      if (afterCountError || (afterCount ?? 0) > record.project_limit) {
        const { error: deleteError } = await supabaseAdmin
          .from('projects').delete().eq('id', project.id).eq('user_id', userId)
        if (deleteError) {
          console.error('[generate:bg] could not delete over-limit project, archiving instead:', deleteError.message)
          await supabaseAdmin.from('projects').update({ status: 'archived' }).eq('id', project.id).eq('user_id', userId)
        }
        if (afterCountError) throw new Error('Failed to create project.')
        throw new Error(`Active project limit reached (${record.project_limit}/${record.project_limit}). Delete a project first, then generate again.`)
      }

      projectId = project.id
      // Surface the newly created project id on the job as soon as we have it — a client
      // polling status can navigate to it even if something later (e.g. the deploy)
      // has trouble, rather than waiting for every last step to succeed first.
      try {
        await supabaseAdmin.from('generation_jobs').update({ project_id: projectId }).eq('id', jobId)
      } catch (err) {
        console.error('[generate:bg] project_id checkpoint write failed (non-fatal):', err)
      }
    }

    // Save code version. On an existing project, append after the latest version instead
    // of hard-coding 1 — duplicate version numbers made "latest version" ambiguous.
    let nextVersionNo = 1
    if (existingProjectId) {
      const { data: latest } = await supabaseAdmin
        .from('code_versions').select('version_no')
        .eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).maybeSingle()
      nextVersionNo = ((latest?.version_no as number | undefined) ?? 0) + 1
    }
    const { data: version, error: versionError } = await supabaseAdmin
      .from('code_versions').insert({
        project_id: projectId,
        user_id: userId,
        version_no: nextVersionNo,
        files: output.files,
        prompt: brief,
      })
      .select().single()

    if (versionError || !version) throw new Error('Failed to save generated files.')
    codeSaved = true

    // Work is durably saved as of this point (code_versions row exists). Record that on
    // the job immediately — the preview deploy below can still fail
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

    // Files removed by the safety filter, surfaced to the Studio via generate/status
    // (`droppedFiles`). Separate best-effort write: if the dropped_files column is missing
    // (supabase/migration-security2-gen-pipeline.sql not run), the update above must
    // still land — it carries code_version_id, which refunds and stale-job cleanup rely on.
    if (output.dropped.length > 0) {
      const { error: droppedError } = await supabaseAdmin
        .from('generation_jobs')
        .update({ dropped_files: normalizeDroppedFiles(output.dropped) })
        .eq('id', jobId)
      if (droppedError) console.error('[generate:bg] dropped_files write failed (non-fatal):', droppedError.message)
    }

    // Credits were debited up front in POST (ref = jobId). If the auto-fix loop later gives
    // up on this version, /api/credits/refund maps the version back to this job's debit.
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
        .from('projects').select('name').eq('id', projectId).single()

      // Deployment name only — the Vercel project is resolved by our project id, never by
      // name (name lookups used to resolve to another tenant's Vercel project).
      const slug = (projectRow?.name ?? 'my-store').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const vercelProjectId = await ensureProjectVercel(projectId as string)

      const allFiles = buildStoreFiles(output.files)

      const result = await createVercelPreviewDeploy(
        vercelProjectId,
        allFiles.map((f) => ({ path: f.path, data: f.content, encoding: f.encoding ?? 'utf-8' })),
        slug,
      )
      deploymentId = result.deploymentId
      previewUrl = result.url

      await insertDeploymentRow({
        project_id: projectId as string,
        user_id: userId,
        vercel_project_id: vercelProjectId,
        vercel_deployment_id: deploymentId,
        status: 'building',
        url: previewUrl.startsWith('https://') ? previewUrl : `https://${previewUrl}`,
        domain: null,
        version: nextVersionNo,
        version_id: version.id,
        code_version_id: version.id,
        target: 'preview',
        scaffold_version: SCAFFOLD_VERSION,
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
    let message = err instanceof Error ? err.message : 'Generation failed unexpectedly.'
    // Refund the up-front debit unless the code was already saved (the user got the work).
    if (!codeSaved) {
      // Core file removed by our own safety filter: uncapped while the small daily
      // allowance lasts (FILTER_REFUNDS_PER_DAY), otherwise the normal capped refund.
      let capped = !infraFailure
      if (err instanceof FilterRejectedError && (await filterRefundAllowanceLeft(userId)) > 0) capped = false
      const refunded = await refundGeneration(userId, jobId, capped)
      if (refunded > 0) message += ` Your ${refunded} credits were refunded.`
      else if (capped) message += ' (Credits were not refunded — daily refund limit reached or refund unavailable.)'
    }
    await failJob(message)
  }
}

/** Number of this user's 'running' jobs started inside the in-flight window. */
async function countInFlightJobs(userId: string): Promise<number | null> {
  const since = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { count, error } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'running').gte('created_at', since)
  if (error) {
    console.error('[generate] in-flight count failed:', error.message)
    return null
  }
  return count ?? 0
}

/**
 * After our own job row exists: is it the oldest of this user's in-flight jobs? Racing
 * requests all see the same set of rows, so exactly one (the oldest) proceeds instead of
 * all of them backing out. null = lookup failed.
 */
async function isOldestInFlightJob(userId: string, jobId: string): Promise<boolean | null> {
  const since = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('generation_jobs').select('id')
    .eq('user_id', userId).eq('status', 'running').gte('created_at', since)
    .order('created_at', { ascending: true }).order('id', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[generate] in-flight re-check failed:', error.message)
    return null
  }
  return (data ?? [])[0]?.id === jobId
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const { brief: rawBrief, projectName: rawProjectName, projectId: rawProjectId } = body ?? {}

  const brief = typeof rawBrief === 'string' ? rawBrief.trim() : ''
  if (!brief) {
    return NextResponse.json({ error: 'Brief is required.' }, { status: 400 })
  }
  if (brief.length > MAX_BRIEF_CHARS) {
    return NextResponse.json({ error: `Brief is too long (max ${MAX_BRIEF_CHARS} characters).` }, { status: 400 })
  }
  const projectName = typeof rawProjectName === 'string' ? rawProjectName.trim().slice(0, 100) || undefined : undefined

  // The client-supplied projectId decides which project the generated code is written
  // into (and later deployed from) — it must belong to the caller.
  let existingProjectId: string | undefined
  if (rawProjectId !== undefined && rawProjectId !== null && rawProjectId !== '') {
    const owned = await getOwnedProject<{ id: string }>(rawProjectId, userId, 'id')
    if (!owned) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    existingProjectId = owned.id
  }

  // Jobs still 'running' past the in-flight window were killed by the platform before
  // their own failure handling ran — close them out and refund their debit (capped, since
  // a deliberately slow brief can cause this). Only jobs that never saved code qualify.
  const staleBefore = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
  const { data: staleJobs } = await supabaseAdmin
    .from('generation_jobs')
    .update({ status: 'failed', phase: null, error: 'Generation timed out.', raw_output: '', files: {} })
    .eq('user_id', userId).eq('status', 'running').lt('created_at', staleBefore).is('code_version_id', null)
    .select('id')
  for (const stale of staleJobs ?? []) {
    await refundGeneration(userId, stale.id as string, true)
  }

  // One generation in flight per user — parallel requests used to all pass the checks
  // below before any of them had written anything.
  const inFlight = await countInFlightJobs(userId)
  if (inFlight === null) {
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }
  if (inFlight > 0) {
    return NextResponse.json({ error: 'A generation is already running. Please wait for it to finish.' }, { status: 409 })
  }

  // Rate limit — counts job rows of every status, so failed generations count too.
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const { count: recentCount, error: recentError } = await supabaseAdmin
    .from('generation_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', oneHourAgo)

  if (recentError || (recentCount ?? 0) >= GENERATE_RATE_LIMIT) {
    return NextResponse.json(
      { error: `Rate limit reached — max ${GENERATE_RATE_LIMIT} generations per hour.` },
      { status: 429 },
    )
  }

  // Project limit check — fail fast before calling Claude (only when creating a new project).
  // Racing requests can't both pass it: the in-flight re-check below lets only one through.
  if (!existingProjectId) {
    const record = await getUserRecord(userId)
    const { count: activeCount } = await supabaseAdmin
      .from('projects').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).neq('status', 'archived')
    if ((activeCount ?? 0) >= record.project_limit) {
      return NextResponse.json({
        error: `Active project limit reached (${activeCount ?? 0}/${record.project_limit}). Delete a project first, or upgrade to Agency for up to 20 stores.`,
      }, { status: 403 })
    }
  }

  // Debit up front, atomically, keyed by the job id — the balance check and the debit are
  // one locked DB operation, so parallel requests can't overspend, and no later write
  // can overwrite credit movements that happen while the job runs. Refunded on failure.
  const jobId = randomUUID()
  const debit = await debitCredits(userId, GENERATE_COST, 'generate', jobId)
  if (!debit.ok) {
    if (debit.error === 'insufficient_credits') {
      return NextResponse.json({ error: `Insufficient credits. Need ${GENERATE_COST}, have ${debit.balance ?? 0}.` }, { status: 402 })
    }
    if (debit.error === 'billing_hold') {
      return NextResponse.json({ error: BILLING_HOLD_MESSAGE, code: 'billing_hold' }, { status: 402 })
    }
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }

  // The generation_jobs row is what the client polls — unlike Level 1 (where a failed
  // insert here just meant "no checkpointing this run, generation proceeds anyway"), this
  // is now load-bearing: with no job row, there is nothing for the client to poll, so a
  // failed insert here must fail the whole request rather than silently degrading.
  const { data: job, error: jobError } = await supabaseAdmin
    .from('generation_jobs')
    .insert({
      id: jobId,
      user_id: userId,
      project_id: existingProjectId ?? null,
      brief,
      status: 'running',
      phase: 'designing',
      credits_debited: true,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    console.error('[generate] generation_jobs insert failed:', jobError)
    await refundGeneration(userId, jobId, false)
    return NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
  }

  // Re-check after our own row exists: if requests raced past the first check, only the
  // oldest in-flight job runs; the others back out (refunded). A backed-out row did no
  // model work, so it is deleted — it must not count toward the hourly limit.
  const oldest = await isOldestInFlightJob(userId, jobId)
  if (oldest !== true) {
    const { error: deleteError } = await supabaseAdmin.from('generation_jobs').delete().eq('id', jobId)
    if (deleteError) {
      await supabaseAdmin
        .from('generation_jobs')
        .update({ status: 'failed', phase: null, error: 'A generation is already running.' })
        .eq('id', jobId)
    }
    await refundGeneration(userId, jobId, false)
    return oldest === null
      ? NextResponse.json({ error: 'Could not start generation. Please try again.' }, { status: 500 })
      : NextResponse.json({ error: 'A generation is already running. Please wait for it to finish.' }, { status: 409 })
  }

  // Scheduled to run after this response is sent — explicitly decoupled from the client's
  // HTTP connection (see the long comment on runGeneration above). Uses supabaseAdmin
  // (service role) throughout, since everything past this point runs outside the normal
  // request lifecycle.
  after(() => runGeneration({
    jobId,
    userId,
    brief,
    projectName,
    existingProjectId,
  }))

  return NextResponse.json({ jobId, projectId: existingProjectId ?? null }, { status: 202 })
}
