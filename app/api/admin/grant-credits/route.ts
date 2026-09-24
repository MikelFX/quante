// POST /api/admin/grant-credits
// Adds credits to a user by email. Requires BOTH a signed-in admin Clerk session
// (lib/admin.ts — verified primary email in ADMIN_EMAILS) AND the ADMIN_SECRET env var,
// so a leaked secret alone can't mint credits and every grant has an admin identity.
// Usage (from an admin browser session):
//   POST { "email": "...", "amount": 1000, "secret": "...", "idempotencyKey"?: "<uuid>" }

import { NextResponse } from 'next/server'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { clerkClient } from '@clerk/nextjs/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { requireAdmin } from '@/lib/admin'
import { grantCredits } from '@/lib/credits'
import { isUuid } from '@/lib/auth/project'

const MAX_GRANT = 10_000 // hard cap per call — a typo can't mint millions of credits
const MIN_SECRET_LENGTH = 32

// Constant-time compare. Hashing both sides first gives equal-length buffers, so neither
// the content nor the length of the real secret leaks through timing.
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  // Rate-limit by IP: max 10 attempts per 15 minutes to blunt brute-force
  const ip = getClientIp(request)
  const rl = rateLimit(`admin-grant:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const adminId = await requireAdmin()
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fail closed on a missing/weak secret BEFORE comparing anything, so the response
  // never differs based on whether the caller guessed correctly.
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret || adminSecret.length < MIN_SECRET_LENGTH) {
    console.error(`ADMIN_SECRET is missing or too short — must be ≥${MIN_SECRET_LENGTH} characters`)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const secret = typeof body.secret === 'string' ? body.secret : ''
  if (!secretMatches(secret, adminSecret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  // Strict number validation: a string like "1000" used to be concatenated into the balance.
  const amount = body.amount === undefined ? 1000 : body.amount
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > MAX_GRANT) {
    return NextResponse.json({ error: `amount must be an integer between 1 and ${MAX_GRANT}` }, { status: 400 })
  }

  // Optional client-supplied idempotency key so a retried request can't grant twice.
  if (body.idempotencyKey !== undefined && !isUuid(body.idempotencyKey)) {
    return NextResponse.json({ error: 'idempotencyKey must be a uuid' }, { status: 400 })
  }
  const refId = isUuid(body.idempotencyKey) ? body.idempotencyKey : randomUUID()

  const clerk = await clerkClient()
  const users = await clerk.users.getUserList({ emailAddress: [email] })
  const user = users.data[0]
  if (!user) return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })

  // Atomic, locked ledger write (lib/credits.ts) — no read-then-insert race.
  const result = await grantCredits(user.id, amount, 'admin_grant', refId)
  if (!result.ok) {
    console.error(`[admin/grant-credits] grant failed for ${user.id}: ${result.error}`)
    return NextResponse.json({ error: 'Failed to grant credits' }, { status: 500 })
  }

  // Audit trail: who granted what to whom (ref_id links to the ledger row).
  console.info(`[admin/grant-credits] admin=${adminId} granted ${amount} to user=${user.id} ref=${refId} alreadyGranted=${result.alreadyGranted}`)

  return NextResponse.json({
    ok: true,
    email,
    added: result.alreadyGranted ? 0 : amount,
    newBalance: result.balance,
    alreadyGranted: result.alreadyGranted,
  })
}
