// Qbox billing (open paid tier, 2026-11-05). Server-only.
//
// Every account pays from a prepaid balance of vCPU-minutes (qbox_topups, see
// supabase/migration-qbox-open.sql). It is filled by
//   • an agent itself over x402 (USDC, lib/qbox/x402.ts): on POST /v1/accounts (new account + key),
//     POST /v1/billing, or by simply repeating any 402-answered request with X-PAYMENT;
//   • a person with Quante credits (POST /v1/billing {credits}, or /qbox) — only accounts that
//     have bought credits with real money (owner: nothing free; welcome credits don't count).
// Sandboxes reserve their whole lifetime when they start; each command / file op costs
// QBOX_PRICING.opVcpuMinutes on top. Short of balance → 402 with a machine-readable offer.

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { debitCredits, refundDebit } from '@/lib/credits'
import { QBOX_PRICING, creditsFor } from './model'
import { QboxNotSetUpError, hasPaidPurchase, paidAccount, type BetaMember } from './store'
import {
  decodePaymentHeader, encodeHeader, paidUsd, paymentHeader, paymentRequiredBody, requirements, settle, x402Config,
} from './x402'

export const isAgentAccount = (userId: string) => userId.startsWith('agent_')

/** Whole dollars that cover `vcpuMinutes` (within the x402 range). */
export function usdFor(vcpuMinutes: number): number {
  const usd = Math.ceil(vcpuMinutes / QBOX_PRICING.vcpuMinutesPerUsd - 1e-9)
  return Math.min(QBOX_PRICING.maxUsd, Math.max(QBOX_PRICING.minUsd, usd))
}

const money = (vcpuMinutes: number) => `$${(vcpuMinutes / QBOX_PRICING.vcpuMinutesPerUsd).toFixed(3)}`

/** Public price list, in every billing answer and the OpenAPI document. */
export function pricing() {
  return {
    unit: 'vCPU-minute (wall-clock lifetime × vCPUs; 2 GB memory per vCPU included)',
    vcpuMinutesPerUsd: QBOX_PRICING.vcpuMinutesPerUsd,
    vcpuMinutesPerCredit: QBOX_PRICING.vcpuMinutesPerCredit,
    perOperationVcpuMinutes: QBOX_PRICING.opVcpuMinutes,
    minimumBilledMinutes: QBOX_PRICING.minBilledMinutes,
    examples: {
      '2 vCPU for 1 hour': money(120),
      '1 vCPU for 10 minutes': money(10),
      'one command or file operation': money(QBOX_PRICING.opVcpuMinutes),
    },
  }
}

const describe = (usd: number) => `Qbox sandbox time: ${usd * QBOX_PRICING.vcpuMinutesPerUsd} vCPU-minutes`

/** The 402 answer when the balance is short: x402 `accepts` (if on) + every other way to pay. */
export function paymentRequired(userId: string, resource: string, balance: number, needed: number, error: string) {
  const cfg = x402Config(process.env)
  const short = Math.max(needed - balance, QBOX_PRICING.opVcpuMinutes)
  const usd = usdFor(short)
  const pay: Record<string, unknown> = {}
  if (cfg) {
    pay.x402 = {
      usd, network: cfg.network,
      howTo: 'Repeat this request with an X-PAYMENT header (x402 v1, USDC). Any whole amount from '
        + `$${QBOX_PRICING.minUsd} to $${QBOX_PRICING.maxUsd} is booked; any x402 client does it automatically.`,
    }
  }
  if (!isAgentAccount(userId)) {
    pay.credits = {
      credits: creditsFor(short),
      howTo: 'POST /api/qbox/v1/billing {"credits": n} spends Quante credits of this account (bought at quantecode.com/billing).',
    }
  }
  const extra = { code: 'payment_required', balanceVcpuMinutes: balance, neededVcpuMinutes: needed, pay, pricing: pricing() }
  const body = cfg ? paymentRequiredBody(requirements(cfg, usd, resource.split('?')[0], describe(usd)), error, extra) : { error, ...extra }
  return { ok: false as const, status: 402, error, body: body as Record<string, unknown> }
}

type Booked = { ok: true; vcpuMinutes: number; usd: number; transaction: string; payer: string | null; network: string; header: string }
  | { ok: false; status: number; error: string }

/**
 * An X-PAYMENT header on the request → verify + settle it and book the top-up to `userId` (once per
 * transaction). The amount is the one the agent signed, if it is a whole number of dollars in range;
 * the facilitator checks it against our requirements (receiver, token, amount). null = no header.
 */
export async function acceptX402(request: Request, userId: string): Promise<Booked | null> {
  const raw = paymentHeader(request.headers)
  if (!raw) return null
  const payment = decodePaymentHeader(raw)
  if (!payment) return { ok: false, status: 400, error: 'The payment header is not valid base64 JSON.' }
  const cfg = x402Config(process.env)
  if (!cfg) return { ok: false, status: 400, error: 'Agent payments (x402) are not switched on.' }
  const usd = paidUsd(payment)
  if (usd === null) {
    return { ok: false, status: 400, error: `Pay a whole number of US dollars from ${QBOX_PRICING.minUsd} to ${QBOX_PRICING.maxUsd} (USDC, 6 decimals).` }
  }
  const s = await settle(cfg, payment, requirements(cfg, usd, request.url.split('?')[0], describe(usd)))
  if (!s.ok) return { ok: false, status: 402, error: s.error }
  const vcpuMinutes = usd * QBOX_PRICING.vcpuMinutesPerUsd
  const booked = await bookX402(userId, usd, s.transaction, s.network, s.payer)
  if (!booked) {
    return { ok: false, status: 500, error: `Paid (transaction ${s.transaction}) but not booked yet. Contact support with this transaction; it will be added.` }
  }
  return { ok: true, vcpuMinutes, usd, transaction: s.transaction, payer: s.payer, network: s.network, header: encodeHeader(s.raw) }
}

/** Books a settled x402 payment once (unique ref). false only on a real database error. */
export async function bookX402(userId: string, usd: number, transaction: string, network: string, payer: string | null): Promise<boolean> {
  const { error } = await supabaseAdmin.from('qbox_topups').insert({
    user_id: userId, vcpu_minutes: usd * QBOX_PRICING.vcpuMinutesPerUsd, source: 'x402', usd_cents: usd * 100,
    ref: `x402:${network}:${transaction}`, note: payer ? `payer ${payer}`.slice(0, 300) : null,
  })
  // A unique-ref conflict means this very payment was booked already: not an error.
  if (error && error.code !== '23505') {
    console.error(`[qbox] x402 paid but not booked: user ${userId}, tx ${transaction}`, error)
    return false
  }
  return true
}

/** Quante credits → Qbox balance (people only, and only after a real purchase). */
export async function topUpWithCredits(userId: string, credits: number) {
  if (isAgentAccount(userId)) return { ok: false as const, status: 400, error: 'Agent accounts pay with x402.' }
  if (!Number.isInteger(credits) || credits < 1 || credits > 10_000) return { ok: false as const, status: 400, error: 'credits must be a whole number 1–10000.' }
  if (!(await hasPaidPurchase(userId))) {
    return { ok: false as const, status: 402, error: 'Qbox is paid only: buy a credit pack first (welcome credits cannot be used for Qbox).' }
  }
  const ref = `qbox_topup:${randomUUID()}`
  const debit = await debitCredits(userId, credits, 'qbox_topup', ref)
  if (!debit.ok) return { ok: false as const, status: 402, error: debit.error === 'insufficient_credits' ? 'Not enough credits.' : 'Credits could not be charged.' }
  const vcpuMinutes = credits * QBOX_PRICING.vcpuMinutesPerCredit
  const { error } = await supabaseAdmin.from('qbox_topups').insert({ user_id: userId, vcpu_minutes: vcpuMinutes, source: 'credits', credits, ref })
  if (error) {
    await refundDebit(userId, ref, 'qbox_topup', 'qbox_topup_failed')
    return { ok: false as const, status: 503, error: 'Qbox paid access is not set up yet. Your credits were returned.' }
  }
  return { ok: true as const, vcpuMinutes, creditsLeft: debit.balance }
}

export type Charge = { ok: true; balance?: number } | { ok: false; status: number; error: string; body?: Record<string, unknown> }

/** Is the paid account's balance at least `needed`? (free beta → always yes) */
export async function ensureBalance(member: BetaMember, resource: string, needed: number): Promise<Charge> {
  if (member.tier !== 'paid') return { ok: true }
  let balance: number
  try {
    balance = (await paidAccount(member.userId, Date.now())).balance
  } catch (e) {
    return { ok: false, status: 503, error: e instanceof QboxNotSetUpError ? e.message : 'Could not read the balance.' }
  }
  if (balance + 1e-9 >= needed) return { ok: true, balance }
  return paymentRequired(member.userId, resource, balance, needed, `Balance too low: ${balance} vCPU-minutes left, this needs ${needed}.`)
}

/** One command / file operation: check and book QBOX_PRICING.opVcpuMinutes (paid tier only). */
export async function chargeOperation(member: BetaMember, resource: string, what: string): Promise<Charge> {
  if (member.tier !== 'paid') return { ok: true }
  const b = await ensureBalance(member, resource, QBOX_PRICING.opVcpuMinutes)
  if (!b.ok) return b
  const { error } = await supabaseAdmin.from('qbox_topups').insert({
    user_id: member.userId, vcpu_minutes: -QBOX_PRICING.opVcpuMinutes, source: 'charge', note: what.slice(0, 300),
  })
  if (error) return { ok: false, status: 503, error: 'Could not book the operation. Try again.' }
  return { ok: true }
}

/**
 * Paid tier: an X-PAYMENT header on any billed request tops up first — the standard x402 retry
 * after our 402. Returns an error response, the X-PAYMENT-RESPONSE header to send back, or null.
 */
export async function payIfOffered(request: Request, member: BetaMember): Promise<NextResponse | { header: string } | null> {
  if (member.tier !== 'paid') return null
  const r = await acceptX402(request, member.userId)
  if (!r) return null
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return { header: r.header }
}
