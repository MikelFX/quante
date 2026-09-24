import { auth } from '@clerk/nextjs/server'
import { getUserRecord } from '@/lib/tier'
import { getBalance } from '@/lib/credits'
import { NextResponse } from 'next/server'
import { ensureWelcomeGrant } from '../welcome-grant'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await getUserRecord(userId)

  // Agency users don't use credits — return tier info only
  if (record.tier === 'agency' && record.subscription_status === 'active') {
    return NextResponse.json({ balance: null, tier: 'agency', project_limit: record.project_limit })
  }

  // First visit: one-time welcome grant (atomic, verified accounts only — see welcome-grant.ts).
  const grant = await ensureWelcomeGrant(userId)
  if (grant.status === 'granted') {
    return NextResponse.json({ balance: grant.balance, isAdmin: grant.isAdmin, tier: record.tier })
  }
  if (grant.status === 'verification_required') {
    return NextResponse.json({ balance: 0, tier: record.tier, verificationRequired: true })
  }
  if (grant.status === 'refused') {
    // Same shape as the verification path; `reason` is additive. Only a throwaway inbox
    // can be fixed by verifying something (a phone), so only it keeps verificationRequired
    // (the Credit pill's "verify to get your free credits" hint). The balance is read, not
    // assumed 0 — a credit-pack purchase may have landed in the meantime.
    const balance = await getBalance(userId)
    return NextResponse.json({
      balance,
      tier: record.tier,
      verificationRequired: grant.reason === 'disposable_email',
      welcomeGrantRefused: true,
      reason: grant.reason,
    })
  }

  const balance = await getBalance(userId)
  return NextResponse.json({ balance, tier: record.tier })
}
