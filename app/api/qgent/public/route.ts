// POST /api/qgent/public — Qgent, the public assistant on the AssetraDigital website.
//
// Read-only: it answers from content/qgent-knowledge.json and can only scroll, open a page or
// OFFER to prefill the lead form (packages/qgent/public.ts). Guards, in order: same-origin
// (proxy.ts CSRF check), Vercel BotID (lib/assetra/bot.ts), per-IP burst limit in memory, then
// one atomic DB call (qgent_public_admit) for the monthly cost cap and the per-session /
// per-IP-per-day limits. Without the migration (supabase/migration-qgent-public.sql) it fails
// closed. The reply streams as NDJSON:
//   {"type":"text","delta":"…"} · {"type":"action",…} · {"type":"done"} · {"type":"error","message":"…"}

import { createHash } from 'node:crypto'
import { isBot } from '@/lib/assetra/bot'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODELS } from '@/lib/claude'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isValidEmail, sendEmail } from '@/lib/email-templates'
import { supabaseAdmin } from '@/lib/supabase/admin'
import knowledge from '@/content/qgent-knowledge.json'
import {
  PUBLIC_LIMITS,
  PUBLIC_TOOLS,
  buildPublicSystemPrompt,
  checkToolCall,
  costUsd,
  redact,
  sanitizeHistory,
  sanitizePage,
  wrapVisitorMessage,
  type QgentAction,
} from '@ad/qgent/public'

export const maxDuration = 60

const PER_SESSION = 30
const PER_IP_DAY = 60
const BURST = 12 // messages per minute per IP and instance
const SYSTEM = buildPublicSystemPrompt(knowledge)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MSG = {
  busy: 'Píšete rychleji, než stíhám. Zkuste to prosím za chvilku.',
  session: 'Tahle konverzace už je dlouhá. Pro další dotazy nám prosím napište přes formulář poptávky.',
  ip: 'Dnes už jste mi poslali hodně zpráv. Další dotazy nám prosím napište přes formulář poptávky.',
  cap: 'Asistent je teď nedostupný. Napište nám prosím přes formulář poptávky, ozveme se.',
  down: 'Asistent je teď nedostupný. Napište nám prosím přes formulář poptávky, ozveme se.',
  bad: 'Zprávu se nepodařilo přečíst. Zkuste ji prosím napsat znovu.',
  failed: 'Odpověď se nepodařila. Zkuste to prosím znovu, nebo nám napište přes formulář poptávky.',
}

function capUsd() {
  const v = Number(process.env.QGENT_MONTHLY_CAP_USD)
  return Number.isFinite(v) && v > 0 ? v : 25
}

function hashIp(ip: string) {
  const salt = process.env.LEAD_IP_SALT || process.env.SECRETS_ENCRYPTION_KEY || 'assetra-leads'
  return createHash('sha256').update(salt + '|qgent|' + ip).digest('hex').slice(0, 32)
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function POST(request: Request) {
  if (await isBot('qgent')) return json({ error: MSG.bad }, 403)

  const ip = getClientIp(request)
  const rl = rateLimit(`qgent:${ip}`, BURST, 60_000)
  if (!rl.allowed) return json({ error: MSG.busy }, 429)

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown; messages?: unknown; page?: unknown } | null
  const sessionId = typeof body?.sessionId === 'string' && UUID_RE.test(body.sessionId) ? body.sessionId.toLowerCase() : null
  const history = sanitizeHistory(body?.messages)
  if (!sessionId || !history) return json({ error: MSG.bad }, 400)
  const page = sanitizePage(body?.page)

  const cap = capUsd()
  const admit = await supabaseAdmin.rpc('qgent_public_admit', {
    p_session: sessionId,
    p_ip_hash: hashIp(ip),
    p_page: page,
    p_max_session: PER_SESSION,
    p_max_ip_day: PER_IP_DAY,
    p_cap_usd: cap,
  })
  if (admit.error) {
    console.error('[qgent] admit failed — run supabase/migration-qgent-public.sql?', admit.error.code, admit.error.message)
    return json({ error: MSG.down }, 503)
  }
  if (admit.data !== 'ok') {
    const key = admit.data === 'cap' ? 'cap' : admit.data === 'ip' ? 'ip' : 'session'
    if (key === 'cap') console.error('[qgent] monthly cap reached')
    return json({ error: MSG[key], limit: key }, 429)
  }

  const messages: Anthropic.MessageParam[] = history.map((t, i) => ({
    role: t.role,
    content: t.role === 'user' ? wrapVisitorMessage(t.text, i === history.length - 1 ? page : undefined) : t.text,
  }))

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      let answer = ''
      let inTok = 0
      let outTok = 0
      let cost = 0
      const actions: QgentAction['type'][] = []
      let acted = false

      try {
        for (let round = 0; round < PUBLIC_LIMITS.toolRounds; round++) {
          const s = anthropic.messages.stream(
            {
              model: MODELS.publicAssistant,
              max_tokens: PUBLIC_LIMITS.maxTokens,
              system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
              tools: PUBLIC_TOOLS,
              // The last round must end in words, not another tool call.
              tool_choice: round === PUBLIC_LIMITS.toolRounds - 1 ? { type: 'none' } : { type: 'auto' },
              messages,
            },
            { signal: request.signal },
          )
          for await (const ev of s) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              answer += ev.delta.text
              send({ type: 'text', delta: ev.delta.text })
            }
          }
          const msg = await s.finalMessage()
          inTok += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0)
          outTok += msg.usage.output_tokens ?? 0
          cost += costUsd(msg.usage)

          if (msg.stop_reason !== 'tool_use') break
          const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          const results: Anthropic.ToolResultBlockParam[] = []
          for (const u of uses) {
            const check = checkToolCall(u.name, u.input)
            // One visible action per answer; extra calls are refused so the page doesn't jump around.
            if (check.ok && !acted) {
              acted = true
              actions.push(check.action.type)
              send({ type: 'action', action: check.action })
              results.push({ type: 'tool_result', tool_use_id: u.id, content: check.result })
            } else {
              results.push({
                type: 'tool_result',
                tool_use_id: u.id,
                is_error: true,
                content: check.ok ? 'Jedna akce za odpověď už proběhla. Další nespouštěj.' : check.error,
              })
            }
          }
          messages.push({ role: 'assistant', content: msg.content })
          messages.push({ role: 'user', content: results })
          if (answer && !answer.endsWith('\n') && !answer.endsWith(' ')) {
            answer += ' '
            send({ type: 'text', delta: ' ' })
          }
        }
        send({ type: 'done' })
      } catch (err) {
        if (!request.signal.aborted) {
          console.error('[qgent] model call failed:', err instanceof Error ? err.message : err)
          send({ type: 'error', message: MSG.failed })
        }
      } finally {
        try { controller.close() } catch {}
      }

      // Bookkeeping after the visitor has the answer. Contacts never reach the database.
      const transcript = [...history, ...(answer.trim() ? [{ role: 'assistant' as const, text: answer.trim() }] : [])]
        .slice(-PUBLIC_LIMITS.historyTurns * 2)
        .map((t) => ({ role: t.role, text: redact(t.text) }))
      if (actions.length) transcript.push({ role: 'assistant', text: `[akce: ${actions.join(', ')}]` })
      const rec = await supabaseAdmin.rpc('qgent_public_record', {
        p_session: sessionId,
        p_transcript: transcript,
        p_input_tokens: inTok,
        p_output_tokens: outTok,
        p_cost: Number(cost.toFixed(6)),
        p_alert_usd: cap * 0.8,
      })
      if (rec.error) console.error('[qgent] record failed:', rec.error.code, rec.error.message)
      else if (rec.data === true) await sendCapAlert(cap)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function sendCapAlert(cap: number) {
  const to = process.env.LEAD_NOTIFY_EMAIL?.trim() ?? ''
  if (!isValidEmail(to)) {
    console.error('[qgent] 80 % of the monthly cap reached, but LEAD_NOTIFY_EMAIL is not set')
    return
  }
  const month = new Date().toISOString().slice(0, 7)
  await sendEmail(
    to,
    `Qgent: 80 % měsíčního limitu (${month})`,
    `<p>Veřejný asistent Qgent na webu AssetraDigital za ${month} utratil 80 % měsíčního limitu ${cap} USD.</p>
<p>Při dosažení limitu se asistent sám vypne a návštěvníkům nabídne formulář poptávky. Limit jde změnit proměnnou <code>QGENT_MONTHLY_CAP_USD</code> na Vercelu.</p>`,
    process.env.LEAD_NOTIFY_FROM || '"Assetra Digital web" <contact@quantecode.com>',
  )
}
