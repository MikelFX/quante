// POST /api/qgent/swarm — 20 Qgent agents go through a store's page live (/qgent, "Review").
// Body { url, rights: true }. Signed-in users only. Answers an NDJSON stream:
//   {t:'page', url, title, lang, layers, total, product?}  the page as layers (the stage draws it)
//   {t:'finding', finding}                                 one finding, as soon as it exists
//   {t:'done', summary, charged, aiFailed}                 the end
//   {t:'error', error}                                     the page could not be read
// The rule-based checks report first (free, instant), then one streamed model call in which the
// agents report (CREDIT_COSTS.qgent_swarm, debitUnlessAgency, refunded when that call fails).
// Nothing is stored and nothing on the site changes: accepting a finding happens in the browser
// and only matters for the rebuild (/qgent "Build", a normal generation).

import { randomUUID } from 'crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { debitUnlessAgency, refundDebit } from '@/lib/credits'
import { CREDIT_COSTS } from '@/lib/config'
import { normalizeScanUrl } from '@/lib/qscan/net'
import { runChecks } from '@/lib/qgent/swarm/checks'
import { admitFinding, normalizeFinding, type SwarmFinding } from '@/lib/qgent/swarm/model'
import { SwarmError, pageLanguage, readHome, readProductPage, runAgents } from '@/lib/qgent/swarm/run'

export const maxDuration = 300

const COST = CREDIT_COSTS.qgent_swarm
const PER_HOUR = 8

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in to send the agents.' }, { status: 401 })

  let body: { url?: unknown; rights?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  const url = typeof body?.url === 'string' ? normalizeScanUrl(body.url) : null
  if (!url) return NextResponse.json({ error: 'Enter the address of a public website, e.g. mystore.com.' }, { status: 400 })
  if (body.rights !== true) return NextResponse.json({ error: 'Confirm that the store is yours or that you may use its content.' }, { status: 400 })

  if (!rateLimit(`qgent-swarm:${userId}`, 2, 60_000).allowed) {
    return NextResponse.json({ error: 'One review at a time — try again in a minute.' }, { status: 429 })
  }
  if (!rateLimit(`qgent-swarm-h:${userId}`, PER_HOUR, 3_600_000).allowed) {
    return NextResponse.json({ error: `You can send the agents ${PER_HOUR} times an hour. Try again later.` }, { status: 429 })
  }

  // The page first: a site that can't be read costs nothing.
  let home
  try {
    home = await readHome(url.toString())
  } catch (err) {
    return NextResponse.json({ error: err instanceof SwarmError ? err.message : 'We couldn’t read the site.' }, { status: 422 })
  }
  if (home.layers.length < 3) {
    return NextResponse.json({ error: 'The page is almost empty for a scanner (it may be built only in JavaScript). Try another page of the store.' }, { status: 422 })
  }

  const runId = randomUUID()
  const debit = await debitUnlessAgency(userId, COST, 'qgent_swarm', runId)
  if (!debit.ok) {
    const msg = debit.error === 'insufficient_credits'
      ? `The review costs ${COST} credits. Top up in Billing.`
      : debit.error === 'billing_hold' ? 'Your account is on a billing hold. Contact support.' : 'Could not charge the credits.'
    return NextResponse.json({ error: msg, credits: debit.error === 'insufficient_credits' }, { status: debit.error === 'insufficient_credits' ? 402 : 403 })
  }
  const charged = debit.agency ? 0 : COST

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')) } catch {}
      }
      const product = await readProductPage(home)
      const productLayers = product?.layers.map((l) => ({ ...l, id: l.id.replace(/^L/, 'P') })) ?? []
      send({
        t: 'page',
        url: home.url,
        title: home.facts.title,
        lang: home.facts.lang.slice(0, 2),
        language: pageLanguage(home),
        layers: home.layers,
        total: home.total + (product?.total ?? 0),
        product: product ? { url: product.url, layers: productLayers } : null,
      })

      const seen: SwarmFinding[] = []
      const emit = (f: SwarmFinding) => {
        if (!admitFinding(f, seen)) return
        seen.push(f)
        send({ t: 'finding', finding: f })
      }
      for (const f of runChecks(home.facts, home.layers, product?.facts ?? null)) emit(f)

      const ids = new Set([...home.layers.map((l) => l.id), ...productLayers.map((l) => l.id)])
      let n = 0
      const ai = await runAgents(home, product, [...seen], (raw) => {
        const f = normalizeFinding(raw, ids, `a-${++n}`)
        if (f) emit(f)
      }, request.signal)

      let refunded = false
      if (!ai.ok && charged) {
        const r = await refundDebit(userId, runId, 'qgent_swarm', 'qgent_swarm_failed')
        refunded = r.ok
      }
      send({
        t: 'done',
        summary: ai.ok ? ai.summary : '',
        charged: refunded ? 0 : charged,
        aiError: ai.ok ? null : `${ai.error}${refunded ? ' Your credits were returned.' : ''}`,
        findings: seen.length,
      })
      try { controller.close() } catch {}
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
