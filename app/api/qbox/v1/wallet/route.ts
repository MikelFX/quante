// The seller's payout wallet for Qbox services.
//   GET /api/qbox/v1/wallet   current wallet + the challenge text to sign (API key)
//   PUT /api/qbox/v1/wallet   {address, signature, issuedAt} — EIP-191 proof that the wallet is yours
// Buyers pay this wallet directly; Qbox never holds your USDC or sees your key.

import { NextResponse } from 'next/server'
import { authorize, toResponse as reply } from '@/lib/qbox/actions'
import { registerWallet, walletInfo } from '@/lib/qbox/services/actions'

export async function GET(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await walletInfo(a), a)
}

export async function PUT(request: Request) {
  const a = await authorize(request)
  if (a instanceof NextResponse) return a
  return reply(await registerWallet(a, await request.json().catch(() => null)), a)
}

export const POST = PUT
