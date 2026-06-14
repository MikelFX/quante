// POST /api/admin/grant-credits
// Protected by ADMIN_SECRET env var. Adds credits to a user by email.
// Usage: POST with { "email": "...", "amount": 1000, "secret": "..." }

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { clerkClient } from '@clerk/nextjs/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  // Rate-limit by IP: max 10 attempts per 15 minutes to blunt brute-force
  const ip = getClientIp(request)
  const rl = rateLimit(`admin-grant:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const { email, amount = 1000, secret } = body as { email?: string; amount?: number; secret?: string }

  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Require the secret to be at least 32 chars — catch weak default values
  if (adminSecret.length < 32) {
    console.error('ADMIN_SECRET is too short — must be ≥32 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const clerk = await clerkClient()
  const users = await clerk.users.getUserList({ emailAddress: [email as string] })
  const user = users.data[0]
  if (!user) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })

  const userId = user.id

  const { data: last } = await supabaseAdmin
    .from('credit_ledger')
    .select('balance_after')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentBalance = (last?.balance_after as number | null) ?? 0
  const newBalance = currentBalance + (amount as number)

  await supabaseAdmin.from('credit_ledger').insert({
    user_id: userId,
    delta: amount,
    reason: 'admin_grant',
    ref_id: null,
    balance_after: newBalance,
  })

  return NextResponse.json({ ok: true, email, added: amount, newBalance })
}
