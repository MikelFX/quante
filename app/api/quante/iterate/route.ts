import { randomUUID } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, ITERATION_MODEL, SYSTEM_PROMPT_CODE_ITERATION } from '@/lib/claude'
import { getOwnedProject } from '@/lib/auth/project'
import { debitCredits, refundDebit } from '@/lib/credits'
import { refundCapped } from '@/app/api/credits/refund/capped'
import { isAgencyUser } from '@/lib/tier'
import { CREDIT_COSTS, RATE_LIMITS, AGENCY_RATE_LIMIT_PER_MIN, AGENCY_TOKEN_CAP } from '@/lib/config'
import { filterAiStoreFiles } from '@/lib/store-template/build'
import { AI_FILTER_PROMPT_NOTE, describeDroppedFiles, normalizeDroppedFiles } from '@/lib/generation-checkpoint'
import type { CodeVersionFiles } from '@/types/store-code'
import { startAttempt, finishAttempt, countRecentAttempts, countInFlightAttempts } from './attempts'
import { autoDeployCodeVersion } from './deploy'

export const maxDuration = 300

const ITERATE_COST = CREDIT_COSTS.iterate
const ITERATE_RATE_LIMIT = RATE_LIMITS.iterate
// At Sonnet output speed ~30k tokens is all that fits in maxDuration anyway; a higher
// cap only let a crafted instruction burn tokens until the function was killed.
const MAX_TOKENS = 32000
// Abort the Claude stream well before maxDuration so we can still refund, save and
// deploy (audit #47) instead of being killed mid-flight.
const SOFT_TIMEOUT_MS = 230_000

// Hard per-request input caps (audit #27, CLAUDE.md §5/§14 cost cap).
const MAX_INSTRUCTION_CHARS = 8000
const MAX_ATTACHED_IMAGES = 4
// Concurrent iterations per user — every one streams a full-store rewrite.
const MAX_IN_FLIGHT = 3
// Agency pays a flat fee, so the attempt log is its only spend guard: besides the
// per-minute limit, cap hourly and daily full-store rewrites (audit #27).
const AGENCY_ITERATE_PER_HOUR = 60
const AGENCY_ITERATE_PER_DAY = 300

// Every refund in this route happens BEFORE the code_versions row exists, so
// /api/credits/refund (which refunds by version id under 'generation_failed') can never
// match the same debit — a distinct reason is double-refund safe. Refunds after reply
// text was already streamed (and every soft-timeout refund) are daily-capped via
// refundCapped — see refundAfterFailure in POST.
const REFUND_REASON = 'iterate_failed'
// debitCredits() refuses accounts flagged after a chargeback (users.billing_hold).
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'

// When the safety filter (filterAiStoreFiles) rejects EVERY file the model rewrote, the
// edit changed nothing. The filter can reject ordinary copy (a 'global' tag, JSX text
// "Function"), so that is refunded — but it can also be provoked on purpose while the
// reply streams, so only a few times per day, counted from ledger refunds carrying this
// reason. It is used for exactly one refund per debit (always before any code_versions
// row exists), so it can never double-refund with REFUND_REASON or /api/credits/refund.
const FILTERED_REFUND_REASON = 'iterate_filtered'
const FILTERED_REFUNDS_PER_DAY = 5

/** True while the user has filter-rejection refunds left today (false on lookup error). */
async function filteredRefundAllowed(userId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('credit_ledger').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('reason', FILTERED_REFUND_REASON).gt('delta', 0)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  if (error) {
    console.error('[iterate] filtered-refund allowance lookup failed:', error.message)
    return false
  }
  return (count ?? 0) < FILTERED_REFUNDS_PER_DAY
}

// SECURITY (audit #25): /api/quante/fix and /api/credits/refund treat code versions whose
// prompt starts with 'Fix:' as free auto-fix versions. A user instruction must never look
// like one, or paid iterates could be chained into a refundable "fix chain".
function storedPrompt(instruction: string): string {
  return /^\s*fix\s*:/i.test(instruction) ? `Edit: ${instruction}` : instruction
}

interface IterateOutput {
  files: CodeVersionFiles
  reply: string
}

function makeStream(fn: (send: (event: object) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: object) {
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')) } catch {}
      }
      try {
        await fn(send)
      } catch (err) {
        console.error('[iterate] failed:', err)
        send({ type: 'error', message: 'Update failed.' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } })
}

/**
 * Failure before the stream starts: a single NDJSON error event (the shape the Studio's
 * stream reader already handles) with a real HTTP status. `error` mirrors `message` for
 * JSON-style callers.
 */
function errorResponse(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ type: 'error', message, error: message, ...extra }) + '\n', {
    status,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' },
  })
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
  const body = await request.json().catch(() => null) as { projectId?: unknown; instruction?: unknown } | null
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : ''

  if (!projectId || !instruction) {
    return errorResponse('projectId and instruction are required.', 400)
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return errorResponse(`Instruction is too long — max ${MAX_INSTRUCTION_CHARS} characters.`, 400)
  }
  if ((instruction.match(/\[Attached image:/g) ?? []).length > MAX_ATTACHED_IMAGES) {
    return errorResponse(`Too many attached images — max ${MAX_ATTACHED_IMAGES} per message.`, 400)
  }

  const { userId } = await auth()
  if (!userId) return errorResponse('Unauthorized.', 401)

  const supabase = await createClient()

  // Ownership check
  const project = await getOwnedProject<{ id: string; name: string | null }>(projectId, userId, 'id, name')
  if (!project) return errorResponse('Project not found.', 404)

  // Load current code version (before charging anything)
  const { data: current } = await supabase
    .from('code_versions').select('files, version_no')
    .eq('project_id', project.id).order('version_no', { ascending: false }).limit(1).maybeSingle()
  if (!current) return errorResponse('No code version found for this project. Generate a store first.', 404)

  const agency = await isAgencyUser(userId)

  // The billing hold (users.billing_hold, set after a chargeback) is enforced by
  // debitCredits() for the credit tier — but agency iterates never debit, so check the
  // flag directly (same as /api/quante/fix). Column missing (migration not run) = no hold.
  if (agency) {
    const { data: holdRow } = await supabaseAdmin
      .from('users').select('billing_hold').eq('id', userId).maybeSingle()
    if ((holdRow as { billing_hold?: boolean } | null)?.billing_hold === true) {
      return errorResponse(BILLING_HOLD_MESSAGE, 402, { code: 'billing_hold' })
    }
  }

  // Attempt log: counts requests when they START (the old limits counted rows that
  // only exist after Claude finishes, so parallel requests all passed — audit #27).
  const attemptId = await startAttempt(userId, 'iterate', project.id)
  if (!attemptId && agency) {
    // Agency pays no credits — the attempt log is its only cost guard. Fail closed.
    return errorResponse('Updates are temporarily unavailable. Try again shortly.', 503)
  }

  // The version id doubles as the debit ref, so /api/credits/refund (which refunds by
  // code version id) keeps working.
  const versionId = randomUUID()
  let debited = false

  // Pre-flight (limits + debit) runs BEFORE the stream opens, so refusals — notably the
  // 402s — carry a real HTTP status. Every early exit finishes the attempt and gives
  // back a debit that was already taken.
  async function reject(message: string, status: number, extra?: Record<string, unknown>): Promise<Response> {
    if (debited) {
      await refundDebit(userId as string, versionId, 'iterate', REFUND_REASON)
      debited = false
    }
    await finishAttempt(attemptId)
    return errorResponse(message, status, extra)
  }

  try {
    if (attemptId) {
      const inFlight = await countInFlightAttempts(userId, 'iterate')
      if (inFlight === null && agency) {
        return await reject('Updates are temporarily unavailable. Try again shortly.', 503)
      }
      if ((inFlight ?? 0) > MAX_IN_FLIGHT) {
        return await reject('Too many updates running at once — wait for one to finish.', 429)
      }
    }

    if (agency) {
      const [perMin, perHour, perDay] = await Promise.all([
        countRecentAttempts(userId, 'iterate', 60_000),
        countRecentAttempts(userId, 'iterate', 3_600_000),
        countRecentAttempts(userId, 'iterate', 86_400_000),
      ])
      if (perMin === null || perHour === null || perDay === null) {
        return await reject('Updates are temporarily unavailable. Try again shortly.', 503)
      }
      // Counts include our own attempt row, hence `>`.
      if (perMin > AGENCY_RATE_LIMIT_PER_MIN) {
        return await reject(`Rate limit reached — max ${AGENCY_RATE_LIMIT_PER_MIN} updates per minute.`, 429)
      }
      if (perHour > AGENCY_ITERATE_PER_HOUR) {
        return await reject(`Rate limit reached — max ${AGENCY_ITERATE_PER_HOUR} updates per hour.`, 429)
      }
      if (perDay > AGENCY_ITERATE_PER_DAY) {
        return await reject(`Daily limit reached — max ${AGENCY_ITERATE_PER_DAY} updates per day.`, 429)
      }
    } else {
      // Credit tier: debit atomically BEFORE any paid work (audit #1 / #47). The
      // reply streams to the client in real time, so it must already be paid for.
      const debit = await debitCredits(userId, ITERATE_COST, 'iterate', versionId)
      if (!debit.ok) {
        if (debit.error === 'insufficient_credits') {
          return await reject(`Insufficient credits. Need ${ITERATE_COST}, have ${debit.balance ?? 0}.`, 402)
        }
        if (debit.error === 'billing_hold') {
          return await reject(BILLING_HOLD_MESSAGE, 402, { code: 'billing_hold' })
        }
        return await reject('Could not reserve credits. Try again.', 500)
      }
      debited = true

      // Hourly limit, counted AFTER our own debit so concurrent requests can't all
      // slip under it. Refunded attempts still count (attempt-based limit).
      const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
      const { count: recentCount } = await supabase
        .from('credit_ledger').select('*', { count: 'exact', head: true })
        .eq('user_id', userId).eq('reason', 'iterate').gte('created_at', oneHourAgo)
      if ((recentCount ?? 0) > ITERATE_RATE_LIMIT) {
        return await reject(`Rate limit reached — max ${ITERATE_RATE_LIMIT} store updates per hour.`, 429)
      }
    }
  } catch (err) {
    console.error('[iterate] pre-flight failed:', err)
    return await reject('Update failed.', 500)
  }

  return makeStream(async (send) => {
    // <reply> text the client has already received (streamed live, see below).
    let replyEmitted = ''

    /**
     * Gives this request's debit back after a failure; returns a note for the error text.
     * Uncapped only while no model output reached the client (a failure on our side where
     * the user got nothing). Once reply text was streamed — or on the soft timeout, which a
     * crafted instruction ("write a 25,000-word reply") forces on purpose — the refund
     * goes through the daily-capped path (credit_refund_claims, shared with generate and
     * /api/credits/refund), or every such request would be a free Sonnet call (R1).
     */
    async function refundAfterFailure(forceCapped = false): Promise<string> {
      if (!debited) return ''
      debited = false
      const failedNote = ' (The credit could not be refunded automatically — contact support.)'
      if (!forceCapped && replyEmitted.length === 0) {
        const res = await refundDebit(userId as string, versionId, 'iterate', REFUND_REASON)
        return res.ok && res.refunded > 0 ? ' Your credit was refunded.' : failedNote
      }
      const res = await refundCapped(userId as string, versionId, 'iterate', REFUND_REASON)
      if (res.ok) return res.refunded > 0 ? ' Your credit was refunded.' : failedNote
      return res.reason === 'limit' ? ' (Credit not refunded — daily refund limit reached.)' : failedNote
    }

    try {
      const currentFiles = current.files as CodeVersionFiles

      // Build file summary for Claude (list of files + content)
      const fileSummary = Object.entries(currentFiles)
        .map(([path, content]) => `=== ${path} ===\n${content}`)
        .join('\n\n')

      const userMessage = `CURRENT FILES:\n${fileSummary}\n\nUSER INSTRUCTION:\n${instruction}\n\n${AI_FILTER_PROMPT_NOTE}`

      send({ type: 'status', text: 'Updating your store…' })

      // Stream Claude response, streaming reply tag content in real time
      let rawOutput = ''
      let inReply = false
      let timedOut = false

      const claudeStream = anthropic.messages.stream({
        model: ITERATION_MODEL,
        max_tokens: agency ? Math.min(AGENCY_TOKEN_CAP, MAX_TOKENS) : MAX_TOKENS,
        system: [{ type: 'text', text: SYSTEM_PROMPT_CODE_ITERATION, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      })
      const softTimeout = setTimeout(() => { timedOut = true; claudeStream.abort() }, SOFT_TIMEOUT_MS)

      try {
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
      } catch (err) {
        if (timedOut) {
          // A crafted instruction can force the timeout on purpose (a long <reply> the
          // client reads live), so this refund is always daily-capped (R1).
          const creditNote = await refundAfterFailure(true)
          send({ type: 'error', message: `The update took too long and was stopped — try a smaller change.${creditNote}` }); return
        }
        throw err
      } finally {
        clearTimeout(softTimeout)
      }

      // Parse the full output
      let output: IterateOutput
      try {
        output = parseIterateOutput(rawOutput)
      } catch {
        const creditNote = await refundAfterFailure()
        send({ type: 'error', message: `Could not parse the updated files. Try again.${creditNote}` }); return
      }

      // SECURITY (audit #23): only allowlisted store paths without server-side
      // capabilities may be saved or deployed. Filter the model's new files first (so a
      // rejected rewrite keeps the previous good version of that file), then the merged
      // set, which also strips disallowed files saved by older versions.
      const newFiles = filterAiStoreFiles(output.files)
      const rejectedNew = normalizeDroppedFiles(newFiles.dropped)

      // Every file the model wrote was rejected: saving would store an unchanged copy
      // of the previous version as a paid edit that did nothing. Save nothing, tell the
      // user plainly, and refund (limited per day — see FILTERED_REFUND_REASON).
      if (rejectedNew.length > 0 && Object.keys(newFiles.files).length === 0) {
        console.warn('[iterate] every AI file failed the safety filter:', rejectedNew)
        let creditNote = ''
        if (debited) {
          debited = false
          if (await filteredRefundAllowed(userId)) {
            const res = await refundDebit(userId, versionId, 'iterate', FILTERED_REFUND_REASON)
            creditNote = res.ok && res.refunded > 0
              ? ' Your credit was refunded.'
              : ' (The credit could not be refunded automatically — contact support.)'
          } else {
            creditNote = ' (Credit not refunded — daily limit for rejected updates reached.)'
          }
        }
        send({
          type: 'error',
          message:
            `No changes were applied — the updated files failed the store safety checks: ${describeDroppedFiles(rejectedNew)}. ` +
            `Try rephrasing the request.${creditNote}`,
          droppedFiles: rejectedNew.map((d) => d.path),
          droppedFileDetails: rejectedNew,
        })
        return
      }

      const merged = filterAiStoreFiles({ ...currentFiles, ...newFiles.files })
      const dropped = normalizeDroppedFiles([...newFiles.dropped, ...merged.dropped])
      if (dropped.length > 0) console.warn('[iterate] dropped disallowed AI files:', dropped)
      const mergedFiles: CodeVersionFiles = merged.files
      // Part of the edit was rejected (the previous version of those files is kept).
      const warning = rejectedNew.length > 0
        ? `Some of the requested changes were not applied — these files failed the store safety checks and kept their previous version: ${describeDroppedFiles(rejectedNew)}.`
        : null

      // Save new code version
      const { data: inserted, error: versionError } = await supabase
        .from('code_versions').insert({
          id: versionId,
          project_id: project.id,
          user_id: userId,
          version_no: current.version_no + 1,
          files: mergedFiles,
          prompt: storedPrompt(instruction),
        })
        .select('id, version_no').single()

      let version = inserted as { id: string; version_no: number } | null
      if (versionError || !version) {
        // The insert may have committed even though we saw an error (dropped connection).
        // Refund only if the row really is absent — otherwise /api/credits/refund could
        // later refund the same debit a second time under its own reason.
        const { data: existing } = await supabaseAdmin
          .from('code_versions').select('id, version_no').eq('id', versionId).eq('project_id', project.id).maybeSingle()
        version = (existing as { id: string; version_no: number } | null) ?? null
        if (!version) {
          const creditNote = await refundAfterFailure()
          send({ type: 'error', message: `Failed to save updated files.${creditNote}` }); return
        }
      }
      // Paid work delivered — the debit stands from here on.
      debited = false

      await supabaseAdmin.from('projects').update({ updated_at: new Date().toISOString() })
        .eq('id', project.id).eq('user_id', userId)

      // Auto-trigger deployment (free). Production only for stores that already went
      // live and whose hosting is active — see ./deploy.ts (audit #0 / #7).
      let deploymentId: string | null = null
      let previewUrl: string | null = null
      send({ type: 'status', text: 'Deploying…' })
      try {
        const result = await autoDeployCodeVersion({
          projectId: project.id,
          projectName: project.name,
          userId,
          files: mergedFiles,
          version: { id: version.id, version_no: version.version_no },
          logTag: 'iterate',
        })
        deploymentId = result.deploymentId
        previewUrl = result.previewUrl
      } catch (err) {
        console.error('[iterate] preview deployment failed (non-fatal):', err)
      }

      send({ type: 'text_chunk', text: '' }) // flush any pending text_chunk
      send({
        type: 'done',
        reply: output.reply,
        versionId: version.id,
        deploymentId,
        previewUrl,
        projectId: project.id,
        droppedFiles: dropped.map((d) => d.path),
        droppedFileDetails: dropped,
        warning,
      })
    } catch (err) {
      // Unexpected failure before the version was saved — give the credit back (capped
      // once the reply already reached the client).
      await refundAfterFailure()
      throw err
    } finally {
      await finishAttempt(attemptId)
    }
  })
}
