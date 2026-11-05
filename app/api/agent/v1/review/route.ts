// POST /api/agent/v1/review — 20 Qgent agents review a store's page for an AI agent (same engine as
// /qgent). Body { url, rights: true }. Auth: Bearer qbx_… (Qbox paid account); paid from its balance
// (lib/agents/paid-price.ts), topped up over x402 by repeating the call with X-PAYMENT. Charged only
// after the page was read, returned when the model call fails. Answers JSON.
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { normalizeScanUrl } from '@/lib/qscan/net'
import { runChecks } from '@/lib/qgent/swarm/checks'
import { admitFinding, normalizeFinding, type SwarmFinding } from '@/lib/qgent/swarm/model'
import { SwarmError, pageLanguage, readHome, readProductPage, runAgents } from '@/lib/qgent/swarm/run'
import { CORS, charge, paidCaller, refund, reply } from '@/lib/agents/paid'
import { agentToolUsd } from '@/lib/agents/paid-price'

export const maxDuration = 300

export async function POST(req: Request) {
  const body = await req.clone().json().catch(() => null) as { url?: unknown; rights?: unknown } | null
  const url = typeof body?.url === 'string' ? normalizeScanUrl(body.url) : null
  if (!url) return NextResponse.json({ error: 'Send { "url": "<public store address>", "rights": true }.' }, { status: 400, headers: CORS })
  if (body?.rights !== true) return NextResponse.json({ error: 'rights must be true: the store is your person\'s, or they may use its content.' }, { status: 400, headers: CORS })

  const c = await paidCaller(req)
  if (c instanceof NextResponse) return c
  if (!rateLimit(`agent-review:${c.member.userId}`, 6, 3_600_000).allowed) return reply(c, { error: 'At most 6 reviews an hour.' }, 429)

  let home
  try {
    home = await readHome(url.toString())
  } catch (err) {
    return reply(c, { error: err instanceof SwarmError ? err.message : 'Could not read the site.', charged: false }, 422)
  }
  if (home.layers.length < 3) return reply(c, { error: 'The page is almost empty for a scanner (JavaScript-only?). Try another page.', charged: false }, 422)

  const booked = await charge(c, 'review', `review ${url.host}`)
  if (!booked.ok) return booked.response

  const product = await readProductPage(home)
  const productLayers = product?.layers.map((l) => ({ ...l, id: l.id.replace(/^L/, 'P') })) ?? []
  const seen: SwarmFinding[] = []
  const emit = (f: SwarmFinding) => { if (admitFinding(f, seen)) seen.push(f) }
  for (const f of runChecks(home.facts, home.layers, product?.facts ?? null)) emit(f)
  const ids = new Set([...home.layers.map((l) => l.id), ...productLayers.map((l) => l.id)])
  let n = 0
  const ai = await runAgents(home, product, [...seen], (raw) => { const f = normalizeFinding(raw, ids, `a-${++n}`); if (f) emit(f) }, req.signal)
  if (!ai.ok) await refund(c, 'review', booked.ref)

  return reply(c, {
    url: home.url,
    title: home.facts.title,
    language: pageLanguage(home),
    productPage: product?.url ?? null,
    summary: ai.ok ? ai.summary : '',
    findings: seen,
    layers: [...home.layers, ...productLayers].map((l) => ({ id: l.id, kind: l.kind, text: l.text })),
    charged: ai.ok ? { usd: agentToolUsd('review') } : false,
    aiError: ai.ok ? null : `${ai.error} The charge was returned; the rule-based findings are included.`,
  })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}
