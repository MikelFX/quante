// Qbox balance + top-ups (API key).
//   GET  /api/qbox/v1/billing                 → { plan, balanceVcpuMinutes, pricing, pay }
//   POST /api/qbox/v1/billing?usd=10          → 402 + x402 `accepts` (agents); with X-PAYMENT → booked
//   POST /api/qbox/v1/billing {"credits": n}  → Quante credits → balance (accounts with a Quante login)

import { NextResponse } from 'next/server'
import { QBOX_PRICING } from '@/lib/qbox/model'
import { authorize, toResponse } from '@/lib/qbox/actions'
import { isAgentAccount, paymentRequired, pricing, topUpWithCredits } from '@/lib/qbox/billing'
import { paidAccount } from '@/lib/qbox/store'
import { parseUsd, x402Config } from '@/lib/qbox/x402'

export const maxDuration = 60

async function balanceOf(userId: string) {
  try {
    return (await paidAccount(userId, Date.now())).balance
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  const paid = a.member.tier === 'paid'
  const cfg = x402Config(process.env)
  return toResponse({
    ok: true,
    data: {
      plan: paid ? 'paid' : 'beta (free, monthly limit)',
      balanceVcpuMinutes: paid ? await balanceOf(a.member.userId) : null,
      pricing: pricing(),
      pay: {
        x402: cfg ? { network: cfg.network, howTo: 'POST /api/qbox/v1/billing?usd=N and pay the 402 with any x402 client.' } : null,
        credits: isAgentAccount(a.member.userId) ? null : { howTo: 'POST /api/qbox/v1/billing {"credits": n}' },
      },
    },
  }, a)
}

export async function POST(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  if (a.member.tier !== 'paid') return toResponse({ ok: false, status: 400, error: 'The free beta has no balance to top up.' }, a)
  // authorize() already settled and booked an X-PAYMENT: answer with the new balance.
  if (a.paymentResponse) return toResponse({ ok: true, data: { balanceVcpuMinutes: await balanceOf(a.member.userId) } }, a)

  const body = await request.json().catch(() => null)
  if (body && typeof body === 'object' && 'credits' in body) {
    const r = await topUpWithCredits(a.member.userId, Number((body as { credits: unknown }).credits))
    if (!r.ok) return toResponse(r, a)
    return toResponse({ ok: true, data: { addedVcpuMinutes: r.vcpuMinutes, creditsLeft: r.creditsLeft, balanceVcpuMinutes: await balanceOf(a.member.userId) } }, a)
  }
  const usd = parseUsd(new URL(request.url).searchParams.get('usd'))
  if (usd === null) return toResponse({ ok: false, status: 400, error: `usd must be a whole number from ${QBOX_PRICING.minUsd} to ${QBOX_PRICING.maxUsd}.` }, a)
  const balance = (await balanceOf(a.member.userId)) ?? 0
  return toResponse(paymentRequired(a.member.userId, request.url, balance, balance + usd * QBOX_PRICING.vcpuMinutesPerUsd, `Top up $${usd}.`), a)
}
