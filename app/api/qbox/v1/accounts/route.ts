// Qbox: an agent opens its own account by paying — no sign-up, no human (owner 2026-11-05).
//
//   POST /api/qbox/v1/accounts?usd=5            → 402 + x402 `accepts` (pay $5 in USDC)
//   POST /api/qbox/v1/accounts  + X-PAYMENT     → 201 { apiKey, accountId, balanceVcpuMinutes }
//
// Only while QBOX_ACCESS=open and x402 is configured (lib/qbox/x402.ts). The account is
// `agent_<hex>` with one API key (shown once) and the paid amount as its balance. Unpaid calls are
// rate-limited per IP; a payment is booked once per transaction.

import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { QBOX_PRICING, isOpenAccess, newApiKey } from '@/lib/qbox/model'
import { bookX402, pricing } from '@/lib/qbox/billing'
import { QBOX_LINKS } from '@/lib/qbox/openapi'
import { decodePaymentHeader, encodeHeader, paidUsd, paymentRequiredBody, parseUsd, requirements, settle, x402Config } from '@/lib/qbox/x402'

export const maxDuration = 60

const err = (status: number, error: string) => NextResponse.json({ error }, { status })

function ip(request: Request) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

const describe = (usd: number) => `Open a Qbox account with ${usd * QBOX_PRICING.vcpuMinutesPerUsd} vCPU-minutes`

export async function POST(request: Request) {
  if (process.env.QBOX_DISABLED === '1') return err(503, 'Qbox is paused. Try again later.')
  if (!isOpenAccess(process.env)) return err(403, `Qbox is invite-only right now. Ask for access at ${QBOX_LINKS.page}.`)
  const cfg = x402Config(process.env)
  if (!cfg) return err(503, `Agent payments are not switched on yet. A person can open an account at ${QBOX_LINKS.page}.`)
  if (!rateLimit(`qbox:accounts:${ip(request)}`, 20, 60 * 60_000).allowed) return err(429, 'Too many account requests from this address. Try again later.')

  const resource = request.url.split('?')[0]
  const raw = request.headers.get('x-payment')
  if (!raw) {
    const usd = parseUsd(new URL(request.url).searchParams.get('usd'))
    if (usd === null) return err(400, `usd must be a whole number from ${QBOX_PRICING.minUsd} to ${QBOX_PRICING.maxUsd}.`)
    return NextResponse.json(paymentRequiredBody(requirements(cfg, usd, resource, describe(usd)),
      'Pay to open a Qbox account. You get an API key and the paid time as your balance.',
      { code: 'payment_required', pricing: pricing(), terms: QBOX_LINKS.terms }), { status: 402 })
  }

  const payment = decodePaymentHeader(raw)
  if (!payment) return err(400, 'X-PAYMENT is not valid base64 JSON.')
  const usd = paidUsd(payment)
  if (usd === null) return err(400, `Pay a whole number of US dollars from ${QBOX_PRICING.minUsd} to ${QBOX_PRICING.maxUsd} (USDC, 6 decimals).`)
  const s = await settle(cfg, payment, requirements(cfg, usd, resource, describe(usd)))
  if (!s.ok) return err(402, s.error)

  // Paid. Account + key, then the top-up. If anything fails from here, the payment stays traceable
  // by its transaction (logged) and support books it by hand.
  const userId = `agent_${randomUUID().replace(/-/g, '')}`
  const key = newApiKey()
  const acc = await supabaseAdmin.from('qbox_agents').insert({ user_id: userId, payer: s.payer, network: s.network })
  const k = acc.error ? acc : await supabaseAdmin.from('qbox_api_keys').insert({ user_id: userId, name: 'agent', key_hash: key.hash, prefix: key.prefix })
  const booked = !k.error && (await bookX402(userId, usd, s.transaction, s.network, s.payer))
  if (!booked) {
    console.error(`[qbox] account payment not completed: tx ${s.transaction} (${s.network}), payer ${s.payer}`, acc.error ?? k.error)
    return err(500, `Paid (transaction ${s.transaction}) but the account could not be created. Contact support with this transaction.`)
  }
  return NextResponse.json({
    accountId: userId,
    apiKey: key.key,
    note: 'Store the key now: it is shown once. Send it as Authorization: Bearer <key>.',
    balanceVcpuMinutes: usd * QBOX_PRICING.vcpuMinutesPerUsd,
    paid: { usd, transaction: s.transaction, network: s.network },
    next: { docs: QBOX_LINKS.llms, openapi: QBOX_LINKS.openapi, mcp: QBOX_LINKS.mcp },
  }, { status: 201, headers: { 'X-PAYMENT-RESPONSE': encodeHeader(s.raw) } })
}
