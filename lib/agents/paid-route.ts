// One paid agent tool as an HTTP answer (server only): with no Bearer key the call pays for itself
// over x402 (lib/agents/pay-per-call.ts: verify → work → settle only on success); with a Bearer
// qbx_… key it is booked on the Qbox balance first and refunded when the work fails.
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { CORS, charge, paidCaller, refund, reply } from './paid'
import { agentToolUsd } from './paid-price'
import { hasApiKey, payPerCall, type Work } from './pay-per-call'
import type { PayPerCallTool } from './pay-per-call-offer'

export async function paidToolResponse(req: Request, t: PayPerCallTool, what: string, work: () => Promise<Work>): Promise<NextResponse> {
  if (!hasApiKey(req)) return payPerCall(req, t, work)

  const c = await paidCaller(req)
  if (c instanceof NextResponse) return c
  if (!rateLimit(`agent-${t.tool}:${c.member.userId}`, t.perIpHour, 3_600_000).allowed) return reply(c, { error: `At most ${t.perIpHour} calls an hour.` }, 429)
  const booked = await charge(c, t.tool, what)
  if (!booked.ok) return booked.response
  let r: Work
  try {
    r = await work()
  } catch {
    r = { ok: false, status: 500, body: { error: 'The tool failed.' } }
  }
  if (!r.ok) {
    await refund(c, t.tool, booked.ref)
    return reply(c, { ...r.body, charged: false }, r.status)
  }
  return reply(c, { ...r.body, charged: { usd: agentToolUsd(t.tool) } })
}

export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400, headers: CORS })

export const preflight = (methods = 'GET, POST, OPTIONS') =>
  new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': methods } })
