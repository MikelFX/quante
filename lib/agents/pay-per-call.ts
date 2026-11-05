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
// The same over MCP (`mcpPaidCall`, x402's MCP transport): the payment rides in
// `_meta["x402/payment"]`, the offer is an isError tool result, the receipt is
// `_meta["x402/payment-response"]`.
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
  verifyPayment, x402Config, type PaymentRequirements, type X402Config,
} from '@/lib/qbox/x402'
import { CORS } from './paid'
import { agentToolUsd, type AgentTool } from './paid-price'
import { clientIp, offerFor, type PayPerCallTool } from './pay-per-call-offer'

export { hasApiKey } from './pay-per-call-offer'
export type { PayPerCallTool } from './pay-per-call-offer'

export type Work = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; body: Record<string, unknown> }

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, ...extra } })

type Outcome =
  | { kind: 'offer'; error: string }
  | { kind: 'failed'; status: number; body: Record<string, unknown> }
  | { kind: 'paid'; body: Record<string, unknown>; receipt: Record<string, unknown> }

/**
 * The transport-free core: a decoded payment (or null) → verify, work, settle. `offer` = answer
 * with the payment offer (no payment, wrong amount, not valid, not settled).
 */
async function paidCall(cfg: X402Config, payment: Record<string, unknown> | null, t: PayPerCallTool, reqs: PaymentRequirements, resource: string, work: () => Promise<Work>): Promise<Outcome> {
  const usd = agentToolUsd(t.tool)
  if (!payment) return { kind: 'offer', error: 'Payment required (x402, USDC). Any x402 client pays this automatically.' }
  if (signedUnits(payment) !== reqs.maxAmountRequired) return { kind: 'offer', error: `Pay exactly ${reqs.maxAmountRequired} USDC base units ($${usd}).` }

  const v = await verifyPayment(cfg, payment, reqs)
  if (!v.ok) return { kind: 'offer', error: v.error }

  let result: Work
  try {
    result = await work()
  } catch {
    result = { ok: false, status: 500, body: { error: 'The tool failed.' } }
  }
  if (!result.ok) return { kind: 'failed', status: result.status, body: { ...result.body, charged: false } }

  const s = await settleVerified(cfg, payment, reqs)
  if (!s.ok) return { kind: 'offer', error: s.error }
  await logCall(t.tool, reqs, s.network, s.transaction, s.payer, resource)
  return { kind: 'paid', body: { ...result.body, charged: { usd, transaction: s.transaction, network: s.network } }, receipt: s.raw as Record<string, unknown> }
}

const OFF = 'Pay-per-call (x402) is not switched on yet. Use a Qbox account: Authorization: Bearer qbx_…'
const limited = (t: PayPerCallTool, ip: string) => !rateLimit(`agent-ppc:${t.tool}:${ip}`, t.perIpHour, 3_600_000).allowed

/** HTTP: runs `work` paid by this one call's x402 payment (see the top of the file). */
export async function payPerCall(req: Request, t: PayPerCallTool, work: () => Promise<Work>): Promise<NextResponse> {
  const cfg = x402Config(process.env)
  if (!cfg) return json({ error: OFF, code: 'x402_off' }, 503)
  if (limited(t, clientIp(req))) return json({ error: `At most ${t.perIpHour} calls an hour from one address.` }, 429)
  const resource = req.url.split('?')[0]
  const { usd, reqs, v2 } = offerFor(cfg, t, resource)

  const raw = paymentHeader(req.headers)
  const payment = raw ? decodePaymentHeader(raw) : null
  if (raw && !payment) return json({ error: 'The payment header is not valid base64 JSON.' }, 400)
  const out = await paidCall(cfg, payment, t, reqs, resource, work)
  if (out.kind === 'offer') {
    const error = raw ? out.error : 'Payment required: PAYMENT-SIGNATURE (x402 v2) or X-PAYMENT (v1), USDC. Any x402 client pays this automatically.'
    return json(
      paymentRequiredBody(reqs, error, { priceUsd: usd, notChargedWhenItFails: true, alternative: 'Authorization: Bearer qbx_… (Qbox account balance)' }),
      402, { 'PAYMENT-REQUIRED': encodeHeader(v2(error)) },
    )
  }
  if (out.kind === 'failed') return json(out.body, out.status)
  const receipt = encodeHeader(out.receipt)
  return json(out.body, 200, { 'PAYMENT-RESPONSE': receipt, 'X-PAYMENT-RESPONSE': receipt })
}

export interface McpToolResult {
  isError?: boolean
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

/**
 * MCP (x402 v2 MCP transport): the payment is `_meta["x402/payment"]`; without it the tool answers
 * isError with the v2 PaymentRequired in structuredContent and content[0].text; the receipt goes
 * back in `_meta["x402/payment-response"]`. `resource` = the MCP server URL.
 */
export async function mcpPaidCall(meta: unknown, ip: string, t: PayPerCallTool, resource: string, work: () => Promise<Work>): Promise<McpToolResult> {
  const text = (d: unknown) => [{ type: 'text' as const, text: JSON.stringify(d) }]
  const cfg = x402Config(process.env)
  if (!cfg) return { isError: true, content: text({ error: OFF }) }
  if (limited(t, ip)) return { isError: true, content: text({ error: `At most ${t.perIpHour} calls an hour from one address.` }) }
  const { reqs, v2 } = offerFor(cfg, t, resource)
  const p = meta && typeof meta === 'object' ? (meta as Record<string, unknown>)['x402/payment'] : undefined
  const payment = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  const out = await paidCall(cfg, payment, t, reqs, resource, work)
  if (out.kind === 'offer') {
    const pr = v2(payment ? out.error : 'Payment required to call this tool (x402, USDC). Retry with _meta["x402/payment"].')
    return { isError: true, structuredContent: pr, content: text(pr) }
  }
  if (out.kind === 'failed') return { isError: true, structuredContent: out.body, content: text(out.body) }
  return { content: text(out.body), structuredContent: out.body, _meta: { 'x402/payment-response': out.receipt } }
}

async function logCall(tool: AgentTool, reqs: PaymentRequirements, network: string, tx: string, payer: string | null, resource: string) {
  const { error } = await supabaseAdmin.from('agent_x402_calls').insert({
    tool, usd_micros: Number(reqs.maxAmountRequired), network, tx, payer, resource: resource.slice(0, 300),
  })
  if (error && error.code !== '23505') console.error(`[agents] x402 call settled but not logged: ${tool} tx ${tx}`, error.message)
}
