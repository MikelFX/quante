import { auth, currentUser } from '@clerk/nextjs/server'
import { createClient } from '@/lib/supabase/server'
import { getUserRecord } from '@/lib/tier'
import { NextResponse } from 'next/server'

const WELCOME_CREDITS = 25
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const record = await getUserRecord(userId)

  // Agency users don't use credits — return tier info only
  if (record.tier === 'agency' && record.subscription_status === 'active') {
    return NextResponse.json({ balance: null, tier: 'agency', project_limit: record.project_limit })
  }

  const { data } = await supabase
    .from('credit_ledger').select('balance_after')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!data) {
    const user = await currentUser()
    const email = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? ''
    const isAdmin = ADMIN_EMAILS.includes(email)
    const grant = isAdmin ? 1000 : WELCOME_CREDITS
    await supabase.from('credit_ledger').insert({
      user_id: userId, delta: grant, reason: isAdmin ? 'admin_grant' : 'welcome_grant', ref_id: null, balance_after: grant,
    })
    return NextResponse.json({ balance: grant, isAdmin, tier: record.tier })
  }

  return NextResponse.json({ balance: data.balance_after, tier: record.tier })
}
