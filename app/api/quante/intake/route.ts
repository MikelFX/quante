import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { anthropic, INTAKE_MODEL, SYSTEM_PROMPT_INTAKE } from '@/lib/claude'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import {
  startAttemptDetailed,
  finishAttempt,
  countInFlightAttempts,
  countRecentAttempts,
  countRecentAttemptsByIp,
} from '../iterate/attempts'

export const maxDuration = 60

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
        send({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' } })
}

// Intake is free (no credits), so it must be bounded some other way — otherwise it is
// an open Claude proxy on Quante's bill. Verified accounts only (same bar as the welcome
// grant), no billing hold, per-user hourly + daily and per-IP hourly limits, and hard
// caps on conversation length and size.
const INTAKE_USER_LIMIT_PER_HOUR = 60
// A real intake is ~5-20 messages; this still allows many briefs a day while bounding
// one throwaway account to a fraction of 60 x 24 calls.
const INTAKE_USER_LIMIT_PER_DAY = 300
const INTAKE_IP_LIMIT_PER_HOUR = 120
const UNAVAILABLE_MESSAGE = 'Quante is temporarily unavailable — please try again shortly.'
const BILLING_HOLD_MESSAGE = 'Your account is on hold after a payment dispute — contact support.'
const VERIFY_MESSAGE = 'Please verify your email address to chat with Quante.'
// Concurrent intake replies per user (the chat UI sends one message at a time).
const INTAKE_MAX_IN_FLIGHT = 3
const MAX_MESSAGES = 30          // keep last 30 turns so long intakes don't lose early details
const MAX_RAW_MESSAGES = 200     // only the newest 200 raw entries are even looked at
const MAX_RAW_PAYLOAD = 2000     // reject absurd payloads before doing any work
const MAX_USER_MSG_CHARS = 4000
// Assistant turns are Quante's own earlier replies (echoed back by the client) — they
// can be longer than a user turn, but never longer than one intake reply.
const MAX_ASSISTANT_MSG_CHARS = 8000
const MAX_TOTAL_CHARS = 60_000

type IntakeMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Normalises client history to exactly {role, content} string messages (no content
 * blocks / extra fields reach the SDK), merges consecutive same-role turns, enforces
 * size caps, and requires the conversation to start AND end with a user turn — a
 * trailing assistant turn would act as a model prefill. Returns null when invalid.
 *
 * Over-long turns are TRUNCATED, never rejected: the client keeps its full history and
 * re-sends it every turn, so rejecting one long pasted brief would break every later
 * request in that conversation. Likewise the total-size cap drops the oldest turns.
 */
function sanitizeHistory(history: unknown): IntakeMessage[] | null {
  if (!Array.isArray(history) || history.length === 0 || history.length > MAX_RAW_PAYLOAD) return null

  const merged: IntakeMessage[] = []
  for (const m of history.slice(-MAX_RAW_MESSAGES)) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string') return null
    const max = role === 'user' ? MAX_USER_MSG_CHARS : MAX_ASSISTANT_MSG_CHARS
    const text = content.slice(0, max * 2).trim().slice(0, max)
    if (!text) continue
    const last = merged[merged.length - 1]
    // Merged same-role turns stay within one turn's cap too.
    if (last && last.role === role) last.content = (last.content + '\n\n' + text).slice(0, max)
    else merged.push({ role, content: text })
  }

  let messages = merged.slice(-MAX_MESSAGES)
  let total = messages.reduce((n, m) => n + m.content.length, 0)
  // Keep the newest turns within the total cap (the final user turn alone always fits).
  while (messages.length > 1 && total > MAX_TOTAL_CHARS) {
    total -= messages[0].content.length
    messages = messages.slice(1)
  }
  // Slicing can leave an assistant turn first — drop it so the list starts with 'user'.
  while (messages.length > 0 && messages[0].role !== 'user') messages = messages.slice(1)
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') return null
  return messages
}

/**
 * The per-IP key comes from X-Forwarded-For. On Vercel the first entry is platform-set;
 * elsewhere it is client-controlled, so never store or key on arbitrary text: accept
 * only a plausible IPv4/IPv6 literal of bounded length, else null (no per-IP DB count —
 * the per-user limits still apply).
 */
function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const ip = raw.trim()
  if (!ip || ip.length > 45 || ip === 'unknown') return null
  if (!/^[0-9A-Fa-f:.]+$/.test(ip)) return null
  if (!ip.includes('.') && !ip.includes(':')) return null
  return ip.toLowerCase()
}

/**
 * Account gate: free Claude calls only for verified accounts that are not on billing
 * hold. Any credit_ledger row proves verification (the welcome grant is only given to
 * verified accounts; other rows are purchases / admin grants), so Clerk is asked only
 * for accounts without one. users.billing_hold missing (migration not run) = no hold.
 */
async function checkAccount(userId: string): Promise<string | null> {
  const [{ data: holdRow }, { data: ledgerRow, error: ledgerError }] = await Promise.all([
    supabaseAdmin.from('users').select('billing_hold').eq('id', userId).maybeSingle(),
    supabaseAdmin.from('credit_ledger').select('id').eq('user_id', userId).limit(1).maybeSingle(),
  ])
  if ((holdRow as { billing_hold?: boolean } | null)?.billing_hold === true) return BILLING_HOLD_MESSAGE
  if (!ledgerError && ledgerRow) return null

  try {
    const user = await currentUser()
    if (!user || user.id !== userId) return UNAVAILABLE_MESSAGE
    const emailVerified = user.primaryEmailAddress?.verification?.status === 'verified'
    const phoneVerified = user.primaryPhoneNumber?.verification?.status === 'verified'
    return emailVerified || phoneVerified ? null : VERIFY_MESSAGE
  } catch (err) {
    console.error('[intake] account lookup failed:', err)
    return UNAVAILABLE_MESSAGE
  }
}

/**
 * DB-backed limits (R6): the in-memory limiter resets per serverless instance / cold
 * start, so it can't bound the fleet. Records the attempt FIRST, then counts (including
 * our own row) per user and per IP, so parallel requests can't all slip under the caps.
 * Returns the attempt id to finish, or a refusal message. Only when the attempt table
 * itself does not exist (migration not run) does it fall back to the in-memory limits;
 * any other attempt-log failure refuses (fail closed — this endpoint is free).
 */
async function checkDbLimits(
  userId: string,
  ip: string | null,
): Promise<{ attemptId: string | null; refusal: string | null }> {
  const started = await startAttemptDetailed(userId, 'intake', null, ip)
  if (!started.id) {
    if (started.missingTable) return { attemptId: null, refusal: null }
    return { attemptId: null, refusal: UNAVAILABLE_MESSAGE }
  }
  const attemptId = started.id

  const [inFlight, perUser, perUserDay, perIp] = await Promise.all([
    countInFlightAttempts(userId, 'intake'),
    countRecentAttempts(userId, 'intake', 3_600_000),
    countRecentAttempts(userId, 'intake', 86_400_000),
    // A missing ip column (migration not run) only disables the per-IP DB count.
    ip ? countRecentAttemptsByIp(ip, 'intake', 3_600_000) : Promise.resolve(0),
  ])
  if (inFlight === null || perUser === null || perUserDay === null) {
    return { attemptId, refusal: UNAVAILABLE_MESSAGE }
  }
  // Counts include our own row, hence `>`.
  if (inFlight > INTAKE_MAX_IN_FLIGHT) {
    return { attemptId, refusal: 'Quante is still answering your previous message — wait for it to finish.' }
  }
  if (perUser > INTAKE_USER_LIMIT_PER_HOUR || (perIp ?? 0) > INTAKE_IP_LIMIT_PER_HOUR) {
    return { attemptId, refusal: 'Too many messages — please wait a while and try again.' }
  }
  if (perUserDay > INTAKE_USER_LIMIT_PER_DAY) {
    return { attemptId, refusal: 'Daily message limit reached — please continue tomorrow, or start generating from what you have.' }
  }
  return { attemptId, refusal: null }
}

export async function POST(request: Request) {
  return makeStream(async (send) => {
    const { userId } = await auth()
    if (!userId) { send({ type: 'error', message: 'Unauthorized.' }); return }

    // In-memory limiter (per serverless instance) — cheap first line; the DB-backed
    // limits below are what actually bound the fleet. Missing / malformed IPs share one
    // in-memory bucket only; they get no per-IP DB count ('unknown' would lump every
    // such client together there).
    const clientIp = normalizeIp(getClientIp(request))
    const userLimit = rateLimit(`intake:${userId}`, INTAKE_USER_LIMIT_PER_HOUR, 3_600_000)
    const ipLimit = rateLimit(`intake-ip:${clientIp ?? 'unknown'}`, INTAKE_IP_LIMIT_PER_HOUR, 3_600_000)
    if (!userLimit.allowed || !ipLimit.allowed) {
      send({ type: 'error', message: 'Too many messages — please wait a while and try again.' }); return
    }

    const accountRefusal = await checkAccount(userId)
    if (accountRefusal) { send({ type: 'error', message: accountRefusal }); return }

    const { attemptId, refusal } = await checkDbLimits(userId, clientIp)
    try {
      if (refusal) { send({ type: 'error', message: refusal }); return }
      await runIntake(request, send)
    } finally {
      await finishAttempt(attemptId)
    }
  })
}

async function runIntake(request: Request, send: (event: object) => void): Promise<void> {
  let history: unknown
  try { ({ history } = await request.json()) }
  catch { send({ type: 'error', message: 'Invalid request body.' }); return }
  if (!Array.isArray(history) || history.length === 0) {
    send({ type: 'error', message: 'History is required.' }); return
  }

  // Anthropic requires messages to start with 'user'. The client sends history
  // starting from the first user message (opening is hardcoded client-side).
  const messages = sanitizeHistory(history)
  if (!messages) {
    send({ type: 'error', message: 'Invalid conversation history — the last message must be from you.' }); return
  }

  let rawOutput = ''
  let sentVisible = 0

  const claudeStream = anthropic.messages.stream({
    model: INTAKE_MODEL,
    // The <ready> brief must be exhaustive (see SYSTEM_PROMPT_INTAKE), so this stays
    // at 4000; cost is bounded by the rate limits and input caps above.
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT_INTAKE, cache_control: { type: 'ephemeral' } }],
    messages,
  })

  for await (const event of claudeStream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      rawOutput += event.delta.text

      // Stream only the visible part — stop before <ready> tag
      const readyStart = rawOutput.indexOf('<ready>')
      const visible = readyStart === -1 ? rawOutput : rawOutput.slice(0, readyStart)

      if (visible.length > sentVisible) {
        send({ type: 'text_chunk', text: visible.slice(sentVisible) })
        sentVisible = visible.length
      }
    }
  }

  const readyMatch = rawOutput.match(/<ready>([\s\S]*?)<\/ready>/)
  if (readyMatch) {
    send({ type: 'ready', brief: readyMatch[1].trim() })
  }
}
