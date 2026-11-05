// Pay-per-call over x402 for the paid agent tools (server only). Most agent purchases on x402 are
// single calls of about a cent from an agent that has no account with the seller (Bazaar /
// x402scan data, 2026-10). So a paid tool also works with no key at all:
//
//   1. call without X-PAYMENT        → 402 with `accepts` (exact price, our wallet, USDC, how to call)
//   2. repeat with X-PAYMENT         → we VERIFY the signed payment (nothing moves yet),
//   3. do the work                   → it fails: nothing is settled, the agent paid nothing,
//   4. it succeeded                  → we SETTLE, answer with X-PAYMENT-RESPONSE and the result.
//
// The result is only sent after the money settled. The amount must be exactly the tool's price.
// Each settled call is logged best-effort in agent_x402_calls (supabase/migration-agent-x402.sql);
// the chain is the source of truth, so a failed log never fails the call.
// Accounts (Bearer qbx_…) keep paying from their Qbox balance (lib/agents/paid.ts).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import {
  decodePaymentHeader, encodeHeader, paymentRequiredBody, requirements, settleVerified, signedUnits,
  verifyPayment, x402Config,
} from '@/lib/qbox/x402'
import { CORS } from './paid'
import { agentToolUsd, type AgentTool } from './paid-price'

export type Work = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> }

export interface PayPerCallTool {
  tool: AgentTool
  description: string
  /** x402 v1 discovery hint: how to call the resource (Bazaar lists it from here). */
  input: Record<string, unknown>
  output: Record<string, unknown>
  /** calls per IP per hour (before any payment) */
  perIpHour: number
}

export const clientIp = (req: Request) =>
  req.headers.get('x-real-ip')?.trim() || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

export const hasApiKey = (req: Request) => /^Bearer\s+\S+/i.test(req.headers.get('authorization') ?? '')

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, ...extra } })

/** Runs `work` paid by this one call's x402 payment (see the top of the file). */
export async function payPerCall(req: Request, t: PayPerCallTool, work: () => Promise<Work>): Promise<NextResponse> {
  const cfg = x402Config(process.env)
  if (!cfg) {
    return json({ error: 'Pay-per-call (x402) is not switched on yet. Use a Qbox account: Authorization: Bearer qbx_…', code: 'x402_off' }, 503)
  }
  if (!rateLimit(`agent-ppc:${t.tool}:${clientIp(req)}`, t.perIpHour, 3_600_000).allowed) {
    return json({ error: `At most ${t.perIpHour} calls an hour from one address.` }, 429)
  }
  const usd = agentToolUsd(t.tool)
  const resource = req.url.split('?')[0]
  const reqs = requirements(cfg, usd, resource, t.description, { input: { type: 'http', ...t.input, discoverable: true }, output: t.output })
  const offer = (error: string) => json(paymentRequiredBody(reqs, error, { priceUsd: usd, notChargedWhenItFails: true, alternative: 'Authorization: Bearer qbx_… (Qbox account balance)' }), 402)

  const raw = req.headers.get('x-payment')
  if (!raw) return offer('X-PAYMENT header is required (x402 v1, USDC). Any x402 client pays this automatically.')
  const payment = decodePaymentHeader(raw)
  if (!payment) return json({ error: 'X-PAYMENT is not valid base64 JSON.' }, 400)
  if (signedUnits(payment) !== reqs.maxAmountRequired) return offer(`Pay exactly ${reqs.maxAmountRequired} USDC base units ($${usd}).`)

  const v = await verifyPayment(cfg, payment, reqs)
  if (!v.ok) return offer(v.error)

  let result: Work
  try {
    result = await work()
  } catch {
    result = { ok: false, status: 500, body: { error: 'The tool failed.' } }
  }
  if (!result.ok) return json({ ...result.body, charged: false }, result.status)

  const s = await settleVerified(cfg, payment, reqs)
  if (!s.ok) return offer(s.error)
  const { error } = await supabaseAdmin.from('agent_x402_calls').insert({
    tool: t.tool, usd_micros: Number(reqs.maxAmountRequired), network: s.network, tx: s.transaction,
    payer: s.payer, resource: resource.slice(0, 300),
  })
  if (error && error.code !== '23505') console.error(`[agents] x402 call settled but not logged: ${t.tool} tx ${s.transaction}`, error.message)
  return json({ ...result.body, charged: { usd, transaction: s.transaction, network: s.network } }, 200, { 'X-PAYMENT-RESPONSE': encodeHeader(s.raw) })
}
