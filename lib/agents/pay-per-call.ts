// Pay-per-call over x402 for the paid agent tools (server only). Most agent purchases on x402 are
// single calls of about a cent from an agent that has no account with the seller (Bazaar /
// x402scan data, 2026-10). So a paid tool also works with no key at all:
//
//   1. call without a payment        → 402: v2 PaymentRequired in the PAYMENT-REQUIRED header (with
//                                      the Bazaar discovery extension) + the v1 offer in the body
//   2. repeat with PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1)
//                                    → we VERIFY the signed payment (nothing moves yet),
//   3. do the work                   → it fails: nothing is settled, the agent paid nothing,
//   4. it succeeded                  → we SETTLE, answer with PAYMENT-RESPONSE / X-PAYMENT-RESPONSE
//                                      and the result.
//
// This is x402's `authorization` flow. The result is only sent after the money settled. The amount
// must be exactly the tool's price. Settled through the Coinbase CDP facilitator, the first paid
// call lists the tool in CDP's Bazaar, where agents look for services. Each settled call is logged
// best-effort in agent_x402_calls (supabase/migration-agent-x402.sql); the chain is the source of
// truth, so a failed log never fails the call. Accounts (Bearer qbx_…) keep paying from their Qbox
// balance (lib/agents/paid.ts).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import {
  decodePaymentHeader, encodeHeader, paymentHeader, paymentRequiredBody, settleVerified, signedUnits,
  verifyPayment, x402Config, type PaymentRequirements,
} from '@/lib/qbox/x402'
import { CORS } from './paid'
import type { AgentTool } from './paid-price'
import { clientIp, offerFor, type PayPerCallTool } from './pay-per-call-offer'

export { hasApiKey } from './pay-per-call-offer'
export type { PayPerCallTool } from './pay-per-call-offer'

export type Work = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> }

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
  const resource = req.url.split('?')[0]
  const { usd, reqs, v2 } = offerFor(cfg, t, resource)
  const offer = (error: string) => json(
    paymentRequiredBody(reqs, error, { priceUsd: usd, notChargedWhenItFails: true, alternative: 'Authorization: Bearer qbx_… (Qbox account balance)' }),
    402, { 'PAYMENT-REQUIRED': encodeHeader(v2(error)) },
  )

  const raw = paymentHeader(req.headers)
  if (!raw) return offer('Payment required: PAYMENT-SIGNATURE (x402 v2) or X-PAYMENT (v1), USDC. Any x402 client pays this automatically.')
  const payment = decodePaymentHeader(raw)
  if (!payment) return json({ error: 'The payment header is not valid base64 JSON.' }, 400)
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
  await logCall(t.tool, reqs, s.network, s.transaction, s.payer, resource)
  const receipt = encodeHeader(s.raw)
  return json({ ...result.body, charged: { usd, transaction: s.transaction, network: s.network } }, 200, { 'PAYMENT-RESPONSE': receipt, 'X-PAYMENT-RESPONSE': receipt })
}

async function logCall(tool: AgentTool, reqs: PaymentRequirements, network: string, tx: string, payer: string | null, resource: string) {
  const { error } = await supabaseAdmin.from('agent_x402_calls').insert({
    tool, usd_micros: Number(reqs.maxAmountRequired), network, tx, payer, resource: resource.slice(0, 300),
  })
  if (error && error.code !== '23505') console.error(`[agents] x402 call settled but not logged: ${tool} tx ${tx}`, error.message)
}
